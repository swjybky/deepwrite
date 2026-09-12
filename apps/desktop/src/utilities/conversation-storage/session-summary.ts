import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import { compactLabel, textPreview } from "./text-preview";

export function sessionSummary(
  sql: Statements,
  nodes: JsonNodes,
  key: string,
  sessionId: string,
  metadata: ValueRef | undefined,
  turnCount: number
) {
  const first = sql
    .get(
      "SELECT preview FROM messages WHERE scope_key = ? AND session_id = ? AND role = 'user' ORDER BY position LIMIT 1"
    )
    .get(key, sessionId);
  const last = sql
    .get(
      "SELECT preview FROM messages WHERE scope_key = ? AND session_id = ? AND preview != '' ORDER BY position DESC LIMIT 1"
    )
    .get(key, sessionId);
  const draft = last
    ? ""
    : textPreview(nodes, metadata && nodes.get(metadata, ["draft"]));
  return {
    title: compactLabel(first ? String(first.preview) : "未命名对话", 42),
    preview: compactLabel(last ? String(last.preview) : draft, 76),
    turnCount
  };
}
