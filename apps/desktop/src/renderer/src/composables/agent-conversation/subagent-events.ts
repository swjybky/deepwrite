import type { AgentConversationContext } from "./context";
import type { SubagentEventEnvelope } from "./types";

type SubagentEventsContext = Pick<
  AgentConversationContext,
  | "ensureSubagentMessage"
  | "ensureSubagentRun"
  | "handleSubagentTurnStarted"
  | "handleSubagentRetryScheduled"
  | "acceptsSubagentRetryActivity"
  | "messageMutations"
  | "earlierTimestamp"
  | "subagentTurnCheckpointByRun"
  | "subagentTurnKey"
>;
export function handleSubagentEvent(
  ctx: SubagentEventsContext,
  event: SubagentEventEnvelope
): void {
  const message = ctx.ensureSubagentMessage(
    event.payload.runId,
    event.timestamp
  );
  message.processingStartedAt ??= event.timestamp;
  const run = ctx.ensureSubagentRun(
    message,
    event.payload,
    event.timestamp,
    event.type === "subagent.started" ? event.payload.task : undefined
  );
  if (
    event.type !== "subagent.completed" &&
    run.status === "running" &&
    (message.status === "stopped" || message.status === "error")
  ) {
    run.status = message.status;
    run.completedAt = message.processingCompletedAt ?? event.timestamp;
    run.errorMessage =
      message.status === "stopped"
        ? "父智能体运行已停止，子任务同步停止。"
        : (message.errorMessage ?? "父智能体运行异常结束，子任务同步停止。");
  }
  if (event.type === "subagent.started") {
    return;
  }
  if (event.type === "subagent.activity") {
    const activity = event.payload.activity;
    if (activity.type === "turn_started") {
      if (run.status === "running") {
        ctx.handleSubagentTurnStarted(event, run, activity);
      }
      return;
    }
    if (activity.type === "retry_scheduled") {
      if (run.status === "running") {
        ctx.handleSubagentRetryScheduled(event, run, activity);
      }
      return;
    }
    if (!ctx.acceptsSubagentRetryActivity(event, run)) return;
    if (activity.type === "thinking_delta") {
      ctx.messageMutations.appendText(run, "thinking", activity.delta);
      const lastStep = run.processingSteps.at(-1);
      if (lastStep?.type === "thinking") {
        ctx.messageMutations.appendText(lastStep, "content", activity.delta);
      } else {
        run.processingSteps.push({
          id: event.id,
          type: "thinking",
          content: activity.delta,
          createdAt: event.timestamp
        });
      }
      return;
    }
    if (activity.type === "message_delta") {
      run.output = `${run.output ?? ""}${activity.delta}`;
      const lastStep = run.processingSteps.at(-1);
      if (lastStep?.type === "response") {
        ctx.messageMutations.appendText(lastStep, "content", activity.delta);
      } else {
        run.processingSteps.push({
          id: event.id,
          type: "response",
          content: activity.delta,
          createdAt: event.timestamp
        });
      }
      return;
    }
    let toolCall = run.toolCalls.find(
      (candidate) => candidate.id === activity.toolCallId
    );
    if (activity.type === "tool_requested") {
      if (toolCall) {
        toolCall.name = activity.toolName;
        toolCall.args = activity.args;
        toolCall.requestedAt = ctx.earlierTimestamp(
          toolCall.requestedAt,
          event.timestamp
        );
        if (toolCall.status !== "completed" && toolCall.status !== "error") {
          toolCall.status = "running";
        }
      } else {
        const terminalStatus =
          run.status === "completed" ? "completed" : "error";
        toolCall = {
          id: activity.toolCallId,
          name: activity.toolName,
          args: activity.args,
          status: run.status === "running" ? "running" : terminalStatus,
          requestedAt: event.timestamp,
          ...(run.status === "running"
            ? {}
            : {
                completedAt: run.completedAt ?? event.timestamp,
                ...(terminalStatus === "error"
                  ? {
                      resultSummary: run.errorMessage ?? "子任务已经结束。",
                      isError: true
                    }
                  : {})
              })
        };
        run.toolCalls.push(toolCall);
      }
      if (
        !run.processingSteps.some(
          (step) =>
            step.type === "tool" && step.toolCallId === activity.toolCallId
        )
      ) {
        run.processingSteps.push({
          id: event.id,
          type: "tool",
          toolCallId: activity.toolCallId,
          createdAt: event.timestamp
        });
      }
      return;
    }
    if (!toolCall) {
      toolCall = {
        id: activity.toolCallId,
        name: activity.toolName,
        args: undefined,
        status: activity.isError ? "error" : "completed",
        requestedAt: event.timestamp
      };
      run.toolCalls.push(toolCall);
    }
    if (
      !run.processingSteps.some(
        (step) =>
          step.type === "tool" && step.toolCallId === activity.toolCallId
      )
    ) {
      run.processingSteps.push({
        id: event.id,
        type: "tool",
        toolCallId: activity.toolCallId,
        createdAt: event.timestamp
      });
    }
    toolCall.name = activity.toolName;
    toolCall.status = activity.isError ? "error" : "completed";
    toolCall.completedAt = event.timestamp;
    toolCall.resultSummary = activity.resultSummary;
    toolCall.isError = activity.isError;
    return;
  }
  run.status =
    event.payload.status === "aborted" ? "stopped" : event.payload.status;
  delete run.retry;
  ctx.subagentTurnCheckpointByRun.delete(
    ctx.subagentTurnKey(event.payload.runId, event.payload.subagentRunId)
  );
  run.completedAt = event.timestamp;
  run.summary = event.payload.summary;
  if (event.payload.errorMessage !== undefined) {
    run.errorMessage = event.payload.errorMessage;
  } else {
    delete run.errorMessage;
  }
  if (event.payload.usage !== undefined) {
    run.usage = { ...event.payload.usage };
  } else {
    delete run.usage;
  }
  for (const toolCall of run.toolCalls) {
    if (toolCall.status !== "preparing" && toolCall.status !== "running") {
      continue;
    }
    toolCall.status = run.status === "completed" ? "completed" : "error";
    toolCall.completedAt = event.timestamp;
    if (run.status !== "completed") {
      toolCall.resultSummary ??= "子任务结束前未返回工具结果。";
      toolCall.isError = true;
    }
  }
}
