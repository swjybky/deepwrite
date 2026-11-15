import type { ExternalToolUsage } from "@deepwrite/contracts";
import type { AgentToolTrace, ChatMessage } from "../../types/conversation";

export function externalToolUsage(messages: readonly ChatMessage[]) {
  const calls = new Map<string, AgentToolTrace>();
  for (const message of messages) {
    for (const call of [
      ...(message.toolCalls ?? []),
      ...(message.subagentRuns ?? []).flatMap((r) => r.toolCalls)
    ])
      calls.set(call.id, call);
  }
  const empty = () => ({
    total: 0,
    succeeded: 0,
    directSucceeded: 0,
    normalizedSucceeded: 0,
    failed: 0,
    pending: 0,
    durationMs: 0
  });
  const total = empty();
  const byTool = new Map<string, ReturnType<typeof empty>>();
  let last: AgentToolTrace | undefined;
  for (const call of calls.values()) {
    const counts = byTool.get(call.name) ?? empty();
    byTool.set(call.name, counts);
    const failed = call.isError === true || call.status === "error";
    const succeeded = !failed && call.status === "completed";
    const elapsed = call.completedAt
      ? Date.parse(call.completedAt) - Date.parse(call.requestedAt)
      : 0;
    for (const value of [counts, total]) {
      value.total++;
      if (failed) value.failed++;
      else if (succeeded) {
        value.succeeded++;
        if (
          call.name === "read" &&
          call.resultSummary?.startsWith("【参数归一化】")
        )
          value.normalizedSucceeded++;
        else value.directSucceeded++;
      } else value.pending++;
      value.durationMs += Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    }
    if (
      (failed || succeeded) &&
      (!last ||
        (call.completedAt ?? call.requestedAt) >=
          (last.completedAt ?? last.requestedAt))
    )
      last = call;
  }
  const toolUsage: ExternalToolUsage = {
    ...total,
    byTool: [...byTool]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, counts]) => ({ name, ...counts }))
  };
  return {
    toolUsage,
    ...(last
      ? {
          lastCompletedTool: {
            name: last.name,
            ...(last.completedAt ? { completedAt: last.completedAt } : {}),
            success: !last.isError && last.status === "completed"
          }
        }
      : {})
  };
}
