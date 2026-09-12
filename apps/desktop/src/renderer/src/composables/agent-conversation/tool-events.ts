import type { AgentConversationContext } from "./context";
import type { SystemEventEnvelope } from "@deepwrite/contracts";

type ToolEventsContext = Pick<
  AgentConversationContext,
  | "acceptsRetryActivity"
  | "ensureActivityMessage"
  | "messageMutations"
  | "ensurePendingSubagentRunForTool"
>;
export function handleToolEvent(
  ctx: ToolEventsContext,
  event: Extract<
    SystemEventEnvelope,
    {
      type:
        "tool.call_stream" | "tool.call_requested" | "tool.execution_completed";
    }
  >
): void {
  const runId = event.payload.runId;
  if (event.type === "tool.call_stream") {
    if (!ctx.acceptsRetryActivity(runId, event.timestamp)) return;
    const message = ctx.ensureActivityMessage(
      runId,
      event.payload.runtime,
      event.timestamp
    );
    message.processingStartedAt ??= event.timestamp;
    let toolCall = event.payload.toolCallId
      ? message.toolCalls?.find(
          (candidate) => candidate.id === event.payload.toolCallId
        )
      : undefined;
    if (!toolCall) {
      const streamCandidate = message.toolCalls?.find(
        (candidate) => candidate.streamId === event.payload.streamId
      );
      const hasCompatibleIdentity =
        !event.payload.toolCallId ||
        streamCandidate?.id === event.payload.toolCallId ||
        streamCandidate?.id === event.payload.streamId;
      if (streamCandidate && hasCompatibleIdentity) {
        toolCall = streamCandidate;
      }
    }
    if (!toolCall) {
      toolCall = {
        id: event.payload.toolCallId ?? event.payload.streamId,
        streamId: event.payload.streamId,
        name: event.payload.toolName ?? "tool_call",
        args: event.payload.args,
        argumentsText: event.payload.argumentsDelta,
        argumentsComplete: event.payload.phase === "end",
        status: "preparing",
        requestedAt: event.timestamp
      };
      (message.toolCalls ??= []).push(toolCall);
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: toolCall.id,
        createdAt: event.timestamp
      });
    } else {
      const previousId = toolCall.id;
      toolCall.streamId = event.payload.streamId;
      toolCall.name = event.payload.toolName ?? toolCall.name;
      ctx.messageMutations.appendText(
        toolCall,
        "argumentsText",
        event.payload.argumentsDelta
      );
      toolCall.argumentsComplete = event.payload.phase === "end";
      if (event.payload.args !== undefined) {
        toolCall.args = event.payload.args;
      }
      if (event.payload.toolCallId && previousId !== event.payload.toolCallId) {
        toolCall.id = event.payload.toolCallId;
        for (const step of message.processingSteps ?? []) {
          if (step.type === "tool" && step.toolCallId === previousId) {
            step.toolCallId = event.payload.toolCallId;
          }
        }
      }
    }
    if (!message.tools?.some((tool) => tool.id === toolCall.id)) {
      message.tools = [
        ...(message.tools ?? []),
        {
          id: toolCall.id,
          name: toolCall.name,
          status: "running"
        }
      ];
    }
    return;
  }
  if (event.type === "tool.call_requested") {
    if (!ctx.acceptsRetryActivity(runId, event.timestamp)) return;
    const message = ctx.ensureActivityMessage(
      runId,
      event.payload.runtime,
      event.timestamp
    );
    if (event.payload.toolName === "spawn_subagent") {
      ctx.ensurePendingSubagentRunForTool(
        message,
        event.payload.toolCallId,
        event.payload.args,
        event.payload.runtime,
        event.timestamp
      );
    }
    if (!message.tools?.some((tool) => tool.id === event.payload.toolCallId)) {
      message.tools = [
        ...(message.tools ?? []),
        {
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          status: "running"
        }
      ];
    }
    message.processingStartedAt ??= event.timestamp;
    const existing =
      message.toolCalls?.find(
        (toolCall) => toolCall.id === event.payload.toolCallId
      ) ??
      [...(message.toolCalls ?? [])]
        .reverse()
        .find(
          (toolCall) =>
            toolCall.status === "preparing" &&
            toolCall.name === event.payload.toolName
        );
    if (existing) {
      const previousId = existing.id;
      existing.id = event.payload.toolCallId;
      existing.name = event.payload.toolName;
      existing.args = event.payload.args;
      existing.status = "running";
      existing.argumentsComplete = true;
      for (const step of message.processingSteps ?? []) {
        if (step.type === "tool" && step.toolCallId === previousId) {
          step.toolCallId = event.payload.toolCallId;
        }
      }
    } else {
      (message.toolCalls ??= []).push({
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        args: event.payload.args,
        status: "running",
        requestedAt: event.timestamp
      });
    }
    if (
      !message.processingSteps?.some(
        (step) =>
          step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )
    ) {
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: event.payload.toolCallId,
        createdAt: event.timestamp
      });
    }
    return;
  }
  if (event.type === "tool.execution_completed") {
    if (!ctx.acceptsRetryActivity(runId, event.timestamp)) return;
    const message = ctx.ensureActivityMessage(
      runId,
      event.payload.runtime,
      event.timestamp
    );
    if (event.payload.toolName === "spawn_subagent") {
      const subagentRun = message.subagentRuns?.find(
        (candidate) => candidate.parentToolCallId === event.payload.toolCallId
      );
      if (subagentRun?.status === "running") {
        subagentRun.status = event.payload.isError ? "error" : "completed";
        subagentRun.completedAt = event.timestamp;
        subagentRun.summary = event.payload.resultSummary;
        if (event.payload.isError) {
          subagentRun.errorMessage = event.payload.resultSummary;
        }
      }
    }
    const tools = message.tools ?? [];
    const existingTool = tools.find(
      (tool) => tool.id === event.payload.toolCallId
    );
    if (existingTool) {
      existingTool.status = event.payload.isError ? "error" : "completed";
      existingTool.summary = event.payload.resultSummary;
    } else {
      message.tools = [
        ...tools,
        {
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          status: event.payload.isError ? "error" : "completed",
          summary: event.payload.resultSummary
        }
      ];
    }
    message.processingStartedAt ??= event.timestamp;
    let toolCall = message.toolCalls?.find(
      (item) => item.id === event.payload.toolCallId
    );
    if (!toolCall) {
      toolCall = {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        args: undefined,
        status: event.payload.isError ? "error" : "completed",
        requestedAt: event.timestamp
      };
      (message.toolCalls ??= []).push(toolCall);
    }
    if (
      !message.processingSteps?.some(
        (step) =>
          step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )
    ) {
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: event.payload.toolCallId,
        createdAt: event.timestamp
      });
    }
    toolCall.name = event.payload.toolName;
    toolCall.status = event.payload.isError ? "error" : "completed";
    toolCall.completedAt = event.timestamp;
    toolCall.resultSummary = event.payload.resultSummary;
    toolCall.isError = event.payload.isError;
    return;
  }
}
