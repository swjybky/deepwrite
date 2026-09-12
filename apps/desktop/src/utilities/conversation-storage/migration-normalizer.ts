import { normalizableLegacyHistory } from "./legacy-history-shape";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import {
  ConversationHistoryIdSchema,
  RendererStateKeySchema
} from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";
import type { Statements } from "./schema";
import type { MessageRecords } from "./message-records";
import type { NormalizingCursor } from "./migration-reader";

export class MigrationNormalizer {
  constructor(
    private readonly sql: Statements,
    private readonly nodes: JsonNodes,
    private readonly records: MessageRecords,
    private readonly source: string,
    readonly cursor: NormalizingCursor
  ) {}

  private scalar(ref: ValueRef, path: string[]): string | undefined {
    const value = this.nodes.get(ref, path);
    return value && "value" in value && typeof value.value === "string"
      ? value.value
      : undefined;
  }

  private array(ref: ValueRef | undefined): ValueRef[] {
    if (!ref || !("node" in ref))
      throw new Error(
        "History conversation messages are not an array; original data has been preserved."
      );
    const node = this.nodes.node(ref.node);
    if (node.kind !== "array")
      throw new Error(
        "History conversation messages are not an array; original data has been preserved."
      );
    return node.entries;
  }

  private transaction(operation: () => void): void {
    this.sql.database.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.sql
        .get("UPDATE migrations SET cursor = ? WHERE source = ?")
        .run(JSON.stringify(this.cursor), this.source);
      this.sql.database.exec("COMMIT");
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }

  private async verify(ref: ValueRef): Promise<string> {
    const hash = createHash("sha256");
    let bytes = 0;
    let sinceYield = 0;
    for (const part of this.nodes.jsonParts(ref)) {
      hash.update(part);
      const count = Buffer.byteLength(part);
      bytes += count;
      sinceYield += count;
      if (sinceYield >= 1024 * 1024) {
        await setImmediate();
        sinceYield = 0;
      }
    }
    if (bytes !== ref.bytes)
      throw new Error("History record failed its migration size check.");
    return hash.digest("hex");
  }

  async run(): Promise<void> {
    const version = this.nodes.get(this.cursor.root, ["version"]);
    const entriesRef = this.nodes.get(this.cursor.root, ["entries"]);
    if (
      !version ||
      !("value" in version) ||
      version.value !== 1 ||
      !entriesRef ||
      !("node" in entriesRef)
    )
      throw new Error(
        "History file format is invalid; original data has been preserved."
      );
    const entries = this.nodes.node(entriesRef.node);
    if (entries.kind !== "object")
      throw new Error(
        "History file entries are invalid; original data has been preserved."
      );
    for (; this.cursor.entry < entries.entries.length;) {
      const [rawKey, value] = entries.entries[this.cursor.entry]!;
      const key = RendererStateKeySchema.parse(rawKey);
      const sessionsRef = this.nodes.get(value, ["conversations"]);
      if (
        !key.startsWith("conversation-history:") ||
        !sessionsRef ||
        (this.cursor.session === 0 &&
          this.cursor.message === 0 &&
          !normalizableLegacyHistory(this.nodes, value))
      ) {
        await this.verify(value);
        this.transaction(() => {
          this.sql
            .get("INSERT INTO legacy_values(key, value_ref) VALUES (?, ?)")
            .run(key, JSON.stringify(value));
          this.cursor.entry++;
        });
        continue;
      }
      const sessions = this.array(sessionsRef);
      for (; this.cursor.session < sessions.length;) {
        const sessionRef = sessions[this.cursor.session]!;
        const sessionId = ConversationHistoryIdSchema.parse(
          this.scalar(sessionRef, ["sessionId"])
        );
        const messagesRef = this.nodes.get(sessionRef, ["messages"]);
        const messages = this.array(messagesRef);
        for (; this.cursor.message < messages.length;) {
          const messageRef = messages[this.cursor.message]!;
          const messageId = ConversationHistoryIdSchema.parse(
            this.scalar(messageRef, ["id"])
          );
          const checksum = await this.verify(messageRef);
          this.transaction(() => {
            this.sql
              .get("INSERT OR IGNORE INTO scopes(key) VALUES (?)")
              .run(key);
            this.sql
              .get(
                "INSERT OR IGNORE INTO sessions(scope_key, session_id) VALUES (?, ?)"
              )
              .run(key, sessionId);
            if (this.records.find(key, sessionId, messageId))
              throw new Error(
                "History has duplicate message IDs; original data has been preserved."
              );
            this.records.save(
              key,
              sessionId,
              messageId,
              this.cursor.message,
              messageRef
            );
            this.sql
              .get(
                "INSERT INTO migration_records(source, scope_key, session_id, message_id, checksum) VALUES (?, ?, ?, ?, ?)"
              )
              .run(this.source, key, sessionId, messageId, checksum);
            this.sql
              .get(
                "UPDATE migrations SET checked_records = checked_records + 1 WHERE source = ?"
              )
              .run(this.source);
            this.cursor.message++;
          });
        }
        this.transaction(() => {
          this.sql.get("INSERT OR IGNORE INTO scopes(key) VALUES (?)").run(key);
          const count = this.sql
            .get(
              "SELECT COUNT(*) AS count FROM messages WHERE scope_key = ? AND session_id = ?"
            )
            .get(key, sessionId);
          if (Number(count?.count) !== messages.length)
            throw new Error(
              "History message count failed migration verification."
            );
          const existing = this.sql
            .get(
              "SELECT metadata_ref FROM sessions WHERE scope_key = ? AND session_id = ?"
            )
            .get(key, sessionId);
          if (existing?.metadata_ref)
            throw new Error(
              "History has duplicate conversation IDs; original data has been preserved."
            );
          const { container, child } = this.nodes.takeField(
            sessionRef,
            "messages"
          );
          this.nodes.releaseContainer(child!);
          this.sql
            .get(
              "INSERT INTO sessions(scope_key, session_id, metadata_ref, updated_at, legacy_position) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope_key, session_id) DO UPDATE SET metadata_ref = excluded.metadata_ref, updated_at = excluded.updated_at, legacy_position = excluded.legacy_position"
            )
            .run(
              key,
              sessionId,
              JSON.stringify(container),
              this.scalar(container, ["updatedAt"]) ?? "",
              this.cursor.session
            );
          this.cursor.session++;
          this.cursor.message = 0;
        });
      }
      this.transaction(() => {
        const active = this.scalar(value, ["activeSessionId"]) ?? null;
        const { container, child } = this.nodes.takeField(
          value,
          "conversations"
        );
        this.nodes.releaseContainer(child!);
        this.sql
          .get(
            "INSERT INTO scopes(key, active_session_id, metadata_ref) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET active_session_id = excluded.active_session_id, metadata_ref = excluded.metadata_ref"
          )
          .run(key, active, JSON.stringify(container));
        this.cursor.entry++;
        this.cursor.session = 0;
      });
    }
  }
}
