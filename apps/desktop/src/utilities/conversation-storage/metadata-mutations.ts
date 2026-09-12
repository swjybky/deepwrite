import type {
  ConversationHistoryBatch,
  ConversationHistoryRecord
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import type { StagedMessages } from "./staging";

function current(
  sql: Statements,
  nodes: JsonNodes,
  key: string,
  sessionId: string
): ValueRef {
  const row = sql
    .get(
      "SELECT metadata_ref FROM sessions WHERE scope_key = ? AND session_id = ?"
    )
    .get(key, sessionId);
  return row?.metadata_ref
    ? (JSON.parse(String(row.metadata_ref)) as ValueRef)
    : nodes.create({});
}

function save(
  sql: Statements,
  nodes: JsonNodes,
  key: string,
  sessionId: string,
  ref: ValueRef
): void {
  const updatedAt = nodes.get(ref, ["updatedAt"]);
  const date =
    updatedAt && "value" in updatedAt && typeof updatedAt.value === "string"
      ? updatedAt.value
      : null;
  sql
    .get(
      "UPDATE sessions SET metadata_ref = ?, updated_at = COALESCE(?, updated_at) WHERE scope_key = ? AND session_id = ?"
    )
    .run(JSON.stringify(ref), date, key, sessionId);
}

export function setMetadata(
  sql: Statements,
  nodes: JsonNodes,
  key: string,
  sessionId: string,
  value: ConversationHistoryRecord
): void {
  let ref = current(sql, nodes, key, sessionId);
  for (const [name, item] of Object.entries(value))
    ref = nodes.patch(ref, { op: "set", path: [name], value: item });
  save(sql, nodes, key, sessionId, ref);
}

export function setStagedMetadata(
  sql: Statements,
  nodes: JsonNodes,
  staged: StagedMessages,
  batch: ConversationHistoryBatch,
  stageId: string,
  path: (string | number)[]
): void {
  const prepared = staged.consume(batch, stageId, "", "metadata");
  const value = nodes.extractField(prepared, "value");
  const ref = nodes.patch(
    current(sql, nodes, batch.key, batch.sessionId),
    { op: "set", path, value: null },
    0,
    value
  );
  save(sql, nodes, batch.key, batch.sessionId, ref);
}
