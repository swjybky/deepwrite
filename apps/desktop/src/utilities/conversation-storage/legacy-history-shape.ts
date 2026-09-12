import { ConversationHistoryIdSchema } from "@deepwrite/contracts";
import type { JsonNodes, ValueRef } from "./json-nodes";

/** Validate only the ownership layout before moving any references out of a legacy key. */
export function normalizableLegacyHistory(
  nodes: JsonNodes,
  root: ValueRef
): boolean {
  const array = (ref: ValueRef | undefined): ValueRef[] | undefined => {
    if (!ref || !("node" in ref)) return;
    const node = nodes.node(ref.node);
    return node.kind === "array" ? node.entries : undefined;
  };
  const id = (ref: ValueRef, key: string): string | undefined => {
    const field = nodes.get(ref, [key]);
    if (!field || !("value" in field)) return;
    const result = ConversationHistoryIdSchema.safeParse(field.value);
    return result.success ? result.data : undefined;
  };
  const sessions = array(nodes.get(root, ["conversations"]));
  if (!sessions) return false;
  const sessionIds = new Set<string>();
  for (const session of sessions) {
    const sessionId = id(session, "sessionId");
    const messages = array(nodes.get(session, ["messages"]));
    if (!sessionId || !messages || sessionIds.has(sessionId)) return false;
    sessionIds.add(sessionId);
    const messageIds = new Set<string>();
    for (const message of messages) {
      const messageId = id(message, "id");
      if (!messageId || messageIds.has(messageId)) return false;
      messageIds.add(messageId);
    }
  }
  return true;
}
