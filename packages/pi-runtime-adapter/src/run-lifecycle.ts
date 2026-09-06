import type { AgentRuntimeEvent } from "./runtime-types";

/** Owns child bookkeeping and idle detection for one parent invocation. */
export class RunLifecycle {
  private readonly children = new Map<
    string,
    Extract<AgentRuntimeEvent, { type: "subagent.started" }>
  >();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  scheduleIdleTimeout(timeoutMs: number, onTimeout: () => void): void {
    this.clearIdleTimer();
    // spawn_subagent is blocking and has its own hard deadline. A silent
    // child request must not consume the waiting parent's idle budget.
    if (this.children.size > 0 || timeoutMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      onTimeout();
    }, timeoutMs);
    this.idleTimer.unref();
  }

  observe(event: AgentRuntimeEvent): AgentRuntimeEvent[] {
    if (event.type === "subagent.started") {
      this.children.set(event.payload.subagentRunId, event);
      this.clearIdleTimer();
    } else if (event.type === "subagent.completed") {
      this.children.delete(event.payload.subagentRunId);
    }
    if (event.type !== "agent.completed" && event.type !== "agent.error") {
      return [];
    }
    this.clearIdleTimer();
    const aborted =
      event.type === "agent.error" && event.payload.code === "pi_agent.aborted";
    const reason =
      event.type === "agent.error"
        ? event.payload.message
        : "父智能体运行已结束，子智能体未返回完整终态。";
    const completed: AgentRuntimeEvent[] = [...this.children.values()].map(
      (child) => ({
        type: "subagent.completed",
        runId: child.runId,
        sessionId: child.sessionId,
        payload: {
          parentToolCallId: child.payload.parentToolCallId,
          subagentRunId: child.payload.subagentRunId,
          subagentId: child.payload.subagentId,
          name: child.payload.name,
          status: aborted ? "aborted" : "error",
          summary:
            event.type === "agent.error"
              ? `父智能体运行${aborted ? "已中止" : "失败"}，子智能体同步停止：${reason}`
              : reason,
          errorMessage: reason,
          runtime: child.payload.runtime
        }
      })
    );
    this.children.clear();
    return completed;
  }

  dispose(): void {
    this.clearIdleTimer();
    this.children.clear();
  }
}
