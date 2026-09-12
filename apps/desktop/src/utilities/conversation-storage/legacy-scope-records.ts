import {
  ConversationHistoryIdSchema,
  type ConversationHistoryJson,
  type ConversationHistoryRecord
} from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";
import type { Statements } from "./schema";
import type { MessageRecords, MessageRow } from "./message-records";

function record(value: ConversationHistoryJson): ConversationHistoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Legacy conversation metadata is not an object.");
  return value;
}

export class LegacyScopeRecords {
  constructor(
    private readonly sql: Statements,
    private readonly nodes: JsonNodes,
    private readonly messages: MessageRecords
  ) {}

  private ref(value: unknown): ValueRef {
    return JSON.parse(String(value)) as ValueRef;
  }
  private array(ref: ValueRef): ValueRef[] {
    if (!("node" in ref))
      throw new Error("Legacy conversation messages are not an array.");
    const node = this.nodes.node(ref.node);
    if (node.kind !== "array")
      throw new Error("Legacy conversation messages are not an array.");
    return node.entries;
  }
  private string(ref: ValueRef, key: string): string | null {
    const child = this.nodes.get(ref, [key]);
    return child && "value" in child && typeof child.value === "string"
      ? child.value
      : null;
  }

  load(key: string): ConversationHistoryJson | undefined {
    const scope = this.sql
      .get(
        "SELECT active_session_id, metadata_ref, removed FROM scopes WHERE key = ?"
      )
      .get(key);
    if (!scope || scope.removed) return undefined;
    const value = scope.metadata_ref
      ? record(this.nodes.read(this.ref(scope.metadata_ref)))
      : { version: 1 };
    const sessions = this.sql
      .get(
        "SELECT session_id, metadata_ref FROM sessions WHERE scope_key = ? AND deleted = 0 ORDER BY legacy_position, session_id"
      )
      .all(key);
    const conversations = sessions.map((session) => {
      const metadata = session.metadata_ref
        ? record(this.nodes.read(this.ref(session.metadata_ref)))
        : { sessionId: String(session.session_id) };
      const rows = this.sql
        .get(
          "SELECT message_id, position, value_ref, byte_length FROM messages WHERE scope_key = ? AND session_id = ? ORDER BY position"
        )
        .all(key, String(session.session_id)) as MessageRow[];
      return {
        ...metadata,
        messages: rows.map((message) =>
          this.nodes.read(this.messages.ref(message))
        )
      };
    });
    if (
      scope.active_session_id !== null ||
      Object.hasOwn(value, "activeSessionId")
    )
      value.activeSessionId =
        scope.active_session_id === null
          ? null
          : String(scope.active_session_id);
    return { ...value, conversations };
  }

  /** Transfer the original live references into a durable backup before clearing their rows. */
  archive(key: string): void {
    const scope = this.sql
      .get(
        "SELECT active_session_id, metadata_ref, removed FROM scopes WHERE key = ?"
      )
      .get(key);
    if (!scope || scope.removed) return;
    let root = scope.metadata_ref
      ? this.ref(scope.metadata_ref)
      : this.nodes.create({ version: 1 });
    let conversations = this.nodes.create([]);
    const sessions = this.sql
      .get(
        "SELECT session_id, metadata_ref FROM sessions WHERE scope_key = ? AND deleted = 0 ORDER BY legacy_position, session_id"
      )
      .all(key);
    for (const [index, session] of sessions.entries()) {
      let metadata = session.metadata_ref
        ? this.ref(session.metadata_ref)
        : this.nodes.create({ sessionId: String(session.session_id) });
      let messages = this.nodes.create([]);
      const rows = this.sql
        .get(
          "SELECT message_id, position, value_ref, byte_length FROM messages WHERE scope_key = ? AND session_id = ? ORDER BY position"
        )
        .all(key, String(session.session_id)) as MessageRow[];
      rows.forEach((message, position) => {
        messages = this.nodes.patch(
          messages,
          { op: "set", path: [position], value: null },
          0,
          this.messages.ref(message)
        );
      });
      metadata = this.nodes.patch(
        metadata,
        { op: "set", path: ["messages"], value: null },
        0,
        messages
      );
      conversations = this.nodes.patch(
        conversations,
        { op: "set", path: [index], value: null },
        0,
        metadata
      );
      this.sql
        .get("DELETE FROM messages WHERE scope_key = ? AND session_id = ?")
        .run(key, String(session.session_id));
    }
    root = this.nodes.patch(
      root,
      { op: "set", path: ["conversations"], value: null },
      0,
      conversations
    );
    if (
      scope.active_session_id !== null ||
      this.nodes.get(root, ["activeSessionId"])
    )
      root = this.nodes.patch(root, {
        op: "set",
        path: ["activeSessionId"],
        value:
          scope.active_session_id === null
            ? null
            : String(scope.active_session_id)
      });
    this.sql
      .get("INSERT INTO legacy_backups(key, value_ref) VALUES (?, ?)")
      .run(key, JSON.stringify(root));
    this.sql
      .get(
        "UPDATE sessions SET metadata_ref = NULL, deleted = 1, revision = revision + 1, generation = generation + 1 WHERE scope_key = ? AND deleted = 0"
      )
      .run(key);
    this.sql
      .get(
        "UPDATE scopes SET metadata_ref = NULL, active_session_id = NULL, removed = 1, epoch = epoch + 1 WHERE key = ?"
      )
      .run(key);
  }

  install(key: string, value: ConversationHistoryRecord): void {
    let root = this.nodes.create(value);
    const extracted = this.nodes.takeField(root, "conversations");
    root = extracted.container;
    if (!extracted.child)
      throw new Error("Legacy conversation list is missing.");
    const conversations = this.array(extracted.child);
    this.sql.get("INSERT OR IGNORE INTO scopes(key) VALUES (?)").run(key);
    const seen = new Set<string>();
    conversations.forEach((session, index) => {
      const sessionId = ConversationHistoryIdSchema.parse(
        this.string(session, "sessionId")
      );
      if (seen.has(sessionId))
        throw new Error("Legacy conversation IDs must be unique.");
      seen.add(sessionId);
      const { container: metadata, child } = this.nodes.takeField(
        session,
        "messages"
      );
      if (!child) throw new Error("Legacy conversation messages are missing.");
      this.sql
        .get(
          "INSERT INTO sessions(scope_key, session_id, metadata_ref, updated_at, legacy_position, revision, generation) VALUES (?, ?, ?, ?, ?, 1, 1) ON CONFLICT(scope_key, session_id) DO UPDATE SET metadata_ref = excluded.metadata_ref, updated_at = excluded.updated_at, legacy_position = excluded.legacy_position, deleted = 0"
        )
        .run(
          key,
          sessionId,
          JSON.stringify(metadata),
          this.string(metadata, "updatedAt") ?? "",
          index
        );
      this.array(child).forEach((message, position) => {
        const messageId = ConversationHistoryIdSchema.parse(
          this.string(message, "id")
        );
        if (this.messages.find(key, sessionId, messageId))
          throw new Error("Legacy message IDs must be unique.");
        this.messages.save(key, sessionId, messageId, position, message);
      });
      this.nodes.releaseContainer(child);
    });
    this.nodes.releaseContainer(extracted.child);
    this.sql
      .get(
        "UPDATE scopes SET metadata_ref = ?, active_session_id = ?, removed = 0 WHERE key = ?"
      )
      .run(JSON.stringify(root), this.string(root, "activeSessionId"), key);
  }
}
