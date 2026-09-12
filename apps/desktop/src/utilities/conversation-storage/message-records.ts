import type {
  ConversationHistoryMessage,
  ConversationHistoryRecord
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import { JsonNodes, type ValueRef } from "./json-nodes";
import { compactLabel, textPreview } from "./text-preview";

export type MessageRow = {
  message_id: string;
  position: number;
  value_ref: string;
  byte_length: number;
};
const DETAIL_FIELDS = new Set([
  "thinking",
  "toolCalls",
  "processingSteps",
  "subagentRuns",
  "editProposals",
  "evaluationSnapshot"
]);

export class MessageRecords {
  constructor(
    private readonly sql: Statements,
    readonly nodes: JsonNodes
  ) {}

  find(
    key: string,
    sessionId: string,
    messageId: string
  ): MessageRow | undefined {
    return this.sql
      .get(
        "SELECT message_id, position, value_ref, byte_length FROM messages WHERE scope_key = ? AND session_id = ? AND message_id = ?"
      )
      .get(key, sessionId, messageId) as MessageRow | undefined;
  }

  ref(row: MessageRow): ValueRef {
    return JSON.parse(row.value_ref) as ValueRef;
  }

  private scalar(ref: ValueRef, path: (string | number)[]): string {
    const value = this.nodes.get(ref, path);
    return value && "value" in value && typeof value.value === "string"
      ? value.value
      : "";
  }

  save(
    key: string,
    sessionId: string,
    messageId: string,
    position: number,
    ref: ValueRef
  ): void {
    const role = this.scalar(ref, ["role"]);
    const status = this.scalar(ref, ["status"]);
    const content = this.nodes.get(ref, ["content"]);
    const preview = content ? this.preview(content) : "";
    const proposals = this.nodes.get(ref, ["editProposals"]);
    let pending = false;
    let reviewing = false;
    if (proposals && "node" in proposals) {
      const array = this.nodes.node(proposals.node);
      if (array.kind === "array")
        for (const proposal of array.entries) {
          const status = this.scalar(proposal, ["status"]);
          const discarding =
            this.scalar(proposal, ["discardState", "status"]) === "discarding";
          pending ||= ["pending", "accepting"].includes(status) || discarding;
          reviewing ||= status === "accepting" || discarding;
        }
    }
    this.sql
      .get(
        "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_key, session_id, message_id) DO UPDATE SET position = excluded.position, value_ref = excluded.value_ref, byte_length = excluded.byte_length, role = excluded.role, preview = excluded.preview, running = excluded.running, pending = excluded.pending, reviewing = excluded.reviewing"
      )
      .run(
        key,
        sessionId,
        messageId,
        position,
        JSON.stringify(ref),
        ref.bytes,
        role,
        preview,
        status === "streaming" ? 1 : 0,
        pending ? 1 : 0,
        reviewing ? 1 : 0
      );
  }

  preview(ref: ValueRef): string {
    return compactLabel(textPreview(this.nodes, ref), 300);
  }

  remove(key: string, sessionId: string, messageId: string): boolean {
    const row = this.find(key, sessionId, messageId);
    if (!row) return false;
    this.nodes.destroy(this.ref(row));
    this.sql
      .get(
        "DELETE FROM messages WHERE scope_key = ? AND session_id = ? AND message_id = ?"
      )
      .run(key, sessionId, messageId);
    return true;
  }

  project(row: MessageRow, maxBytes: number): ConversationHistoryMessage {
    const ref = this.ref(row);
    if (!("node" in ref))
      throw new Error("Conversation message is not an object.");
    const node = this.nodes.node(ref.node);
    if (node.kind !== "object")
      throw new Error("Conversation message is not an object.");
    const value: ConversationHistoryRecord = {};
    const details: ConversationHistoryMessage["details"] = [];
    let remaining = Math.max(0, maxBytes - 1024);
    for (const [key, child] of node.entries) {
      if (DETAIL_FIELDS.has(key) || child.bytes > remaining) {
        const text =
          "value" in child
            ? typeof child.value === "string"
            : this.nodes.node(child.node).kind === "text";
        details.push({
          path: [key],
          byteLength: child.bytes,
          encoding: text ? "text" : "json"
        });
      } else {
        Object.defineProperty(value, key, {
          value: this.nodes.read(child),
          enumerable: true,
          writable: true,
          configurable: true
        });
        remaining -= child.bytes + Buffer.byteLength(JSON.stringify(key)) + 1;
      }
    }
    const result = {
      messageId: row.message_id,
      position: row.position,
      value,
      details,
      byteLength: row.byte_length
    };
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
      result.value = {};
      result.details = [{ path: [], encoding: "json", byteLength: ref.bytes }];
    }
    return result;
  }
}
