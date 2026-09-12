import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationHistoryBatch,
  ConversationHistoryCommitResult,
  ConversationHistoryOperation,
  ConversationHistoryMergeScopesQuery,
  ConversationHistoryMergeScopesResult,
  ConversationHistoryStage,
  ConversationHistoryStageResult
} from "@deepwrite/contracts";
import { openConversationDatabase, Statements } from "./schema";
import { JsonNodes } from "./json-nodes";
import { MessageRecords } from "./message-records";
import { ConversationQueries } from "./queries";
import { ConversationStorageError } from "./errors";
import { batchFingerprint, StagedMessages } from "./staging";
import { ConversationRuntimeRecovery } from "./runtime-recovery";
import { setMetadata, setStagedMetadata } from "./metadata-mutations";
import { ConversationScopeMerger } from "./scope-merger";
export { ConversationStorageError } from "./errors";

export class ConversationDatabase extends ConversationQueries {
  readonly database: DatabaseSync;
  private readonly staged: StagedMessages;
  private readonly recovery: ConversationRuntimeRecovery;
  constructor(path: string) {
    const database = openConversationDatabase(path);
    const sql = new Statements(database);
    const nodes = new JsonNodes(sql);
    const records = new MessageRecords(sql, nodes);
    super(sql, nodes, records);
    this.database = database;
    this.recovery = new ConversationRuntimeRecovery(sql, nodes, records);
    this.staged = new StagedMessages(sql, nodes, () =>
      this.recovery.assertWriter()
    );
  }

  claimMainInstance(id: string): void {
    this.recovery.claim(id);
  }
  assertMainInstance(): void {
    this.recovery.assertWriter();
  }

  stage(batch: ConversationHistoryStage): ConversationHistoryStageResult {
    return this.staged.stage(batch);
  }

  mergeScopes(
    query: ConversationHistoryMergeScopesQuery
  ): ConversationHistoryMergeScopesResult {
    return new ConversationScopeMerger(this.sql, this.nodes, () =>
      this.recovery.assertWriter()
    ).merge(query);
  }

  commit(batch: ConversationHistoryBatch): ConversationHistoryCommitResult {
    const fingerprint = batchFingerprint(batch);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.recovery.assertWriter();
      const receipt = this.sql
        .get(
          "SELECT revision, generation, sequence, fingerprint FROM receipts WHERE scope_key = ? AND session_id = ? AND batch_id = ?"
        )
        .get(batch.key, batch.sessionId, batch.batchId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ConversationStorageError(
            "batch_reused",
            "The same conversation batch ID was reused for different data."
          );
        this.database.exec("COMMIT");
        return {
          batchId: batch.batchId,
          revision: Number(receipt.revision),
          generation: Number(receipt.generation),
          sequence: Number(receipt.sequence)
        };
      }
      if (
        this.sql.get("SELECT removed FROM scopes WHERE key = ?").get(batch.key)
          ?.removed
      )
        throw new ConversationStorageError(
          "scope_removed",
          "This conversation scope was removed; stale queued changes cannot restore it."
        );
      const existing = this.sql
        .get(
          "SELECT revision, generation, sequence, deleted FROM sessions WHERE scope_key = ? AND session_id = ?"
        )
        .get(batch.key, batch.sessionId);
      if (
        batch.expectedRevision !== (existing?.revision ?? 0) ||
        batch.generation !== (existing?.generation ?? 0)
      ) {
        throw new ConversationStorageError(
          "revision_conflict",
          "Conversation changed before this batch could be saved."
        );
      }
      if (batch.sequence <= Number(existing?.sequence ?? 0))
        throw new ConversationStorageError(
          "stale_sequence",
          "Conversation batch is out of order."
        );
      if (
        existing?.deleted &&
        !batch.operations.every(
          (operation) => operation.type === "setDeleted" && !operation.deleted
        )
      ) {
        throw new ConversationStorageError(
          "session_deleted",
          "Restore this conversation before changing it."
        );
      }
      this.sql
        .get("INSERT OR IGNORE INTO scopes(key) VALUES (?)")
        .run(batch.key);
      this.sql
        .get("UPDATE scopes SET incremental = 1 WHERE key = ?")
        .run(batch.key);
      this.sql
        .get(
          "INSERT OR IGNORE INTO sessions(scope_key, session_id) VALUES (?, ?)"
        )
        .run(batch.key, batch.sessionId);
      let advances = false;
      for (const operation of batch.operations)
        advances = this.apply(batch, operation) || advances;
      for (const operation of batch.operations) {
        if (
          operation.type !== "putMessage" &&
          operation.type !== "putStagedMessage" &&
          operation.type !== "moveMessage"
        )
          continue;
        const duplicate = this.sql
          .get(
            "SELECT COUNT(*) AS count FROM messages WHERE scope_key = ? AND session_id = ? AND position = ?"
          )
          .get(batch.key, batch.sessionId, operation.position);
        if (Number(duplicate?.count) > 1)
          throw new ConversationStorageError(
            "duplicate_position",
            "Conversation message positions must be unique."
          );
      }
      const result = {
        batchId: batch.batchId,
        revision: batch.expectedRevision + 1,
        generation: batch.generation + (advances ? 1 : 0),
        sequence: batch.sequence
      };
      this.sql
        .get(
          "UPDATE sessions SET revision = ?, generation = ?, sequence = ? WHERE scope_key = ? AND session_id = ?"
        )
        .run(
          result.revision,
          result.generation,
          result.sequence,
          batch.key,
          batch.sessionId
        );
      this.sql
        .get(
          "INSERT INTO receipts(scope_key, session_id, batch_id, revision, generation, sequence, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          batch.key,
          batch.sessionId,
          batch.batchId,
          result.revision,
          result.generation,
          result.sequence,
          fingerprint
        );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private apply(
    batch: ConversationHistoryBatch,
    operation: ConversationHistoryOperation
  ): boolean {
    const { key, sessionId } = batch;
    if (operation.type === "moveMessage") {
      const result = this.sql
        .get(
          "UPDATE messages SET position = ? WHERE scope_key = ? AND session_id = ? AND message_id = ?"
        )
        .run(operation.position, key, sessionId, operation.messageId);
      if (!result.changes)
        throw new ConversationStorageError(
          "message_missing",
          "Conversation message no longer exists."
        );
    } else if (
      operation.type === "putMessage" ||
      operation.type === "putStagedMessage"
    ) {
      const old = this.records.find(key, sessionId, operation.messageId);
      const ref =
        operation.type === "putMessage"
          ? this.nodes.create(operation.value)
          : this.staged.consume(batch, operation.stageId, operation.messageId);
      this.records.save(
        key,
        sessionId,
        operation.messageId,
        operation.position,
        ref
      );
      if (old) this.nodes.destroy(this.records.ref(old));
    } else if (operation.type === "setStagedField") {
      const row = this.records.find(key, sessionId, operation.messageId);
      if (!row)
        throw new ConversationStorageError(
          "message_missing",
          "Conversation message no longer exists."
        );
      const prepared = this.staged.consume(
        batch,
        operation.stageId,
        operation.messageId
      );
      const field = this.nodes.extractField(prepared, "value");
      const ref = this.nodes.patch(
        this.records.ref(row),
        { op: "set", path: operation.path, value: null },
        0,
        field
      );
      this.records.save(key, sessionId, operation.messageId, row.position, ref);
    } else if (operation.type === "patchMessage") {
      const row = this.records.find(key, sessionId, operation.messageId);
      if (!row)
        throw new ConversationStorageError(
          "message_missing",
          "Conversation message no longer exists."
        );
      let ref = this.records.ref(row);
      for (const change of operation.changes)
        ref = this.nodes.patch(ref, change);
      this.records.save(key, sessionId, operation.messageId, row.position, ref);
    } else if (operation.type === "removeMessages") {
      let removed = false;
      for (const id of operation.messageIds)
        removed = this.records.remove(key, sessionId, id) || removed;
      return removed;
    } else if (operation.type === "setMetadata") {
      setMetadata(this.sql, this.nodes, key, sessionId, operation.value);
    } else if (operation.type === "setStagedMetadata") {
      setStagedMetadata(
        this.sql,
        this.nodes,
        this.staged,
        batch,
        operation.stageId,
        operation.path
      );
    } else if (operation.type === "setActive") {
      const selected = this.sql
        .get(
          "SELECT deleted FROM sessions WHERE scope_key = ? AND session_id = ?"
        )
        .get(key, operation.sessionId);
      if (!selected || selected.deleted)
        throw new ConversationStorageError(
          "session_missing",
          "The selected conversation is unavailable."
        );
      this.sql
        .get("UPDATE scopes SET active_session_id = ? WHERE key = ?")
        .run(operation.sessionId, key);
    } else if (operation.type === "setDeleted") {
      const row = this.sql
        .get(
          "SELECT deleted FROM sessions WHERE scope_key = ? AND session_id = ?"
        )
        .get(key, sessionId)!;
      if (Boolean(row.deleted) === operation.deleted) return false;
      if (
        operation.deleted &&
        this.sql
          .get(
            "SELECT 1 FROM messages WHERE scope_key = ? AND session_id = ? AND (running = 1 OR pending = 1) LIMIT 1"
          )
          .get(key, sessionId)
      ) {
        throw new ConversationStorageError(
          "session_busy",
          "Stop the run and finish pending review before deleting this conversation."
        );
      }
      this.sql
        .get(
          "UPDATE sessions SET deleted = ? WHERE scope_key = ? AND session_id = ?"
        )
        .run(operation.deleted ? 1 : 0, key, sessionId);
      if (operation.deleted)
        this.sql
          .get(
            "UPDATE scopes SET active_session_id = NULL WHERE key = ? AND active_session_id = ?"
          )
          .run(key, sessionId);
      return true;
    }
    return false;
  }

  /** Bounded idle maintenance. Soft-deleted sessions retain all referenced content. */
  collectUnreferencedChunks(limit = 128): number {
    const removed = Number(
      this.sql
        .get(
          "DELETE FROM chunks WHERE hash IN (SELECT hash FROM chunk_collection_queue ORDER BY rowid LIMIT ?) AND NOT EXISTS (SELECT 1 FROM node_chunks WHERE node_chunks.hash = chunks.hash)"
        )
        .run(limit).changes
    );
    this.sql
      .get(
        "DELETE FROM chunk_collection_queue WHERE hash IN (SELECT hash FROM chunk_collection_queue ORDER BY rowid LIMIT ?)"
      )
      .run(limit);
    return removed;
  }

  checkpoint(): void {
    this.database.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }
  close(): void {
    this.database.close();
  }
}
