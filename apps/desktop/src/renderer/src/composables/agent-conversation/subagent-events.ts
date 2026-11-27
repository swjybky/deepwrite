import { stripModelCallSnapshot } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import type { AgentConversationContext } from "./context";
import type { TrackedMessages } from "./message-mutations";
import { queueSubagentTextDelta } from "./subagent-text-deltas";
import type {
  SubagentEventEnvelope,
  SubagentPlannedEventEnvelope
} from "./types";

const t = createScopedTranslator("workspace");

type SubagentEventsContext = Pick<
  AgentConversationContext,
  | "ensureSubagentMessage"
  | "ensureSubagentRun"
  | "handleSubagentTurnStarted"
  | "handleSubagentRetryScheduled"
  | "acceptsSubagentRetryActivity"
  | "pendingSubagentTextDeltas"
  | "scheduleStreamPresentation"
  | "earlierTimestamp"
  | "subagentTurnCheckpointByRun"
  | "subagentTurnKey"
> & { messageMutations: Pick<TrackedMessages, "appendText"> };
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
        ? t("runLifecycle.theParentAgentStoppedSubtasksWereAlsoStopped")
        : (message.errorMessage ??
          t(
            "subagentEvents.theParentAgentEndedUnexpectedlySubtasksWereAlsoStopped"
          ));
  }
  if (event.type === "subagent.started") {
    return;
  }
  if (event.type === "subagent.activity") {
    const activity = event.payload.activity;
    if (activity.type === "model_call") {
      const strippedCall = stripModelCallSnapshot(activity.call);
      const calls = (run.modelCalls ??= []);
      const index = calls.findIndex(
        (call) => call.requestId === strippedCall.requestId
      );
      if (index < 0) calls.push(strippedCall);
      else if (!calls[index]?.endedAt) calls[index] = strippedCall;
      return;
    }
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
    if (
      activity.type === "thinking_delta" ||
      activity.type === "message_delta"
    ) {
      queueSubagentTextDelta(
        ctx,
        ctx.subagentTurnKey(event.payload.runId, event.payload.subagentRunId),
        run,
        {
          type: activity.type,
          text: activity.delta,
          eventId: event.id,
          createdAt: event.timestamp
        }
      );
      ctx.scheduleStreamPresentation();
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
                      resultSummary:
                        run.errorMessage ??
                        t("subagentEvents.theSubtaskHasAlreadyEnded"),
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
      toolCall.resultSummary ??= t(
        "subagentEvents.theSubtaskEndedWithoutReturningAToolResult"
      );
      toolCall.isError = true;
    }
  }
}

/**
 * Names every queued card of a multi-task call before its children start,
 * with the scheduler's final dependencies. Started cards keep their own state.
 */
export function handleSubagentPlanned(
  ctx: Pick<AgentConversationContext, "ensureSubagentMessage">,
  event: SubagentPlannedEventEnvelope
): void {
  const { parentToolCallId, runId, tasks } = event.payload;
  const message = ctx.ensureSubagentMessage(runId, event.timestamp);
  message.processingStartedAt ??= event.timestamp;
  for (const planned of tasks) {
    const batchTask = {
      index: planned.index,
      key: planned.key,
      dependsOn: [...planned.dependsOn]
    };
    const run = message.subagentRuns?.find(
      (candidate) =>
        candidate.parentToolCallId === parentToolCallId &&
        candidate.batchTask?.index === planned.index
    );
    if (run) {
      if (run.status !== "queued") continue;
      run.subagentId = planned.subagentId;
      run.name = planned.name;
      run.task = planned.task;
      run.runtime = { ...planned.runtime };
      run.batchTask = batchTask;
      if (planned.drawCount !== undefined) run.drawCount = planned.drawCount;
      continue;
    }
    (message.subagentRuns ??= []).push({
      parentToolCallId,
      subagentRunId: `pending:${parentToolCallId}:${planned.index}`,
      subagentId: planned.subagentId,
      name: planned.name,
      task: planned.task,
      status: "queued",
      runtime: { ...planned.runtime },
      toolCalls: [],
      processingSteps: [],
      startedAt: event.timestamp,
      batchTask,
      ...(planned.drawCount !== undefined
        ? { drawCount: planned.drawCount }
        : {})
    });
  }
}
