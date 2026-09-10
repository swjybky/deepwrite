import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Copy only complete historical tool exchanges; never replay the pending spawn. */
export function snapshotSubagentHistory(
  messages: readonly AgentMessage[]
): AgentMessage[] {
  const copied = structuredClone(messages) as AgentMessage[];
  const completed = new Set(
    copied
      .filter((message) => message.role === "toolResult")
      .map((message) => message.toolCallId)
  );
  const calls = new Set<string>();
  for (const message of copied) {
    if (message.role !== "assistant") continue;
    message.content = message.content.filter((content) => {
      if (content.type !== "toolCall") return true;
      if (!completed.has(content.id)) return false;
      calls.add(content.id);
      return true;
    });
  }
  return copied.filter((message) => {
    if (message.role === "toolResult") return calls.has(message.toolCallId);
    if (message.role === "assistant") return message.content.length > 0;
    return true;
  });
}
