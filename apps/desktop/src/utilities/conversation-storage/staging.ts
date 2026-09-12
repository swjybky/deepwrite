import { createHash } from "node:crypto";
import type {
  ConversationHistoryBatch,
  ConversationHistoryStage,
  ConversationHistoryStageResult
} from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";
import type { Statements } from "./schema";
import { ConversationStorageError } from "./errors";

export function batchFingerprint(payload: unknown): string {
  // Transport batches have a bounded byte budget; historical content is never included here.
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class StagedMessages {
  constructor(
    private readonly sql: Statements,
    private readonly nodes: JsonNodes,
    private readonly assertWriter: () => void = () => {}
  ) {}

  stage(batch: ConversationHistoryStage): ConversationHistoryStageResult {
    const fingerprint = batchFingerprint(batch);
    const target = batch.target ?? "message";
    const messageId = target === "metadata" ? "" : batch.messageId;
    if (messageId === undefined)
      throw new ConversationStorageError(
        "message_missing",
        "Message preparation requires a message ID."
      );
    this.sql.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWriter();
      const receipt = this.sql
        .get(
          "SELECT fingerprint, sequence FROM stage_receipts WHERE scope_key = ? AND session_id = ? AND stage_id = ? AND chunk_id = ?"
        )
        .get(batch.key, batch.sessionId, batch.stageId, batch.chunkId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ConversationStorageError(
            "batch_reused",
            "The same conversation chunk ID was reused for different data."
          );
        this.sql.database.exec("COMMIT");
        return {
          stageId: batch.stageId,
          chunkId: batch.chunkId,
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
      const current = this.sql
        .get(
          "SELECT revision, generation, deleted FROM sessions WHERE scope_key = ? AND session_id = ?"
        )
        .get(batch.key, batch.sessionId);
      if (
        batch.expectedRevision !== (current?.revision ?? 0) ||
        batch.generation !== (current?.generation ?? 0) ||
        current?.deleted
      )
        throw new ConversationStorageError(
          "revision_conflict",
          "Conversation changed before message preparation."
        );
      const stage = this.sql
        .get(
          "SELECT message_id, target, expected_revision, generation, sequence, value_ref, consumed FROM stages WHERE scope_key = ? AND session_id = ? AND stage_id = ?"
        )
        .get(batch.key, batch.sessionId, batch.stageId);
      let ref: ValueRef;
      if (stage) {
        if (
          stage.message_id !== messageId ||
          stage.target !== target ||
          stage.expected_revision !== batch.expectedRevision ||
          stage.generation !== batch.generation ||
          stage.consumed
        )
          throw new ConversationStorageError(
            "stage_conflict",
            "The prepared message no longer matches this conversation."
          );
        if (
          batch.sequence !== Number(stage.sequence) + 1 ||
          batch.value !== undefined
        )
          throw new ConversationStorageError(
            "stale_sequence",
            "Prepared message chunks must arrive in order."
          );
        ref = JSON.parse(String(stage.value_ref)) as ValueRef;
      } else {
        if (batch.sequence !== 1 || batch.value === undefined)
          throw new ConversationStorageError(
            "stage_missing",
            "The first prepared message chunk is missing."
          );
        ref = this.nodes.create(batch.value);
      }
      for (const change of batch.changes ?? [])
        ref = this.nodes.patch(ref, change);
      this.sql
        .get(
          "INSERT INTO stages(scope_key, session_id, stage_id, message_id, target, expected_revision, generation, sequence, value_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_key, session_id, stage_id) DO UPDATE SET sequence = excluded.sequence, value_ref = excluded.value_ref"
        )
        .run(
          batch.key,
          batch.sessionId,
          batch.stageId,
          messageId,
          target,
          batch.expectedRevision,
          batch.generation,
          batch.sequence,
          JSON.stringify(ref)
        );
      this.sql
        .get(
          "INSERT INTO stage_receipts(scope_key, session_id, stage_id, chunk_id, fingerprint, sequence) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
          batch.key,
          batch.sessionId,
          batch.stageId,
          batch.chunkId,
          fingerprint,
          batch.sequence
        );
      this.sql.database.exec("COMMIT");
      return {
        stageId: batch.stageId,
        chunkId: batch.chunkId,
        sequence: batch.sequence
      };
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Called inside the final commit transaction; ownership transfers without decoding content. */
  consume(
    batch: ConversationHistoryBatch,
    stageId: string,
    messageId: string,
    target: "message" | "metadata" = "message"
  ): ValueRef {
    const stage = this.sql
      .get(
        "SELECT message_id, target, expected_revision, generation, value_ref, consumed FROM stages WHERE scope_key = ? AND session_id = ? AND stage_id = ?"
      )
      .get(batch.key, batch.sessionId, stageId);
    if (
      !stage ||
      stage.consumed ||
      stage.message_id !== messageId ||
      stage.target !== target ||
      stage.expected_revision !== batch.expectedRevision ||
      stage.generation !== batch.generation
    )
      throw new ConversationStorageError(
        "stage_conflict",
        "The prepared message no longer matches this conversation."
      );
    this.sql
      .get(
        "UPDATE stages SET consumed = 1, value_ref = NULL WHERE scope_key = ? AND session_id = ? AND stage_id = ?"
      )
      .run(batch.key, batch.sessionId, stageId);
    return JSON.parse(String(stage.value_ref)) as ValueRef;
  }
}
