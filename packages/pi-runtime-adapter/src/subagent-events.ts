import type { AgentRuntimeRef } from "@deepwrite/contracts";
import { toRuntimeEvents } from "./event-mapping";
import type { AgentRunEventSource, AgentRuntimeEvent } from "./runtime-types";
import type { SubagentToolProgress } from "./subagent-runtime";

/** @internal Exported for subagent protocol regression tests. */
export function toSubagentRuntimeEvents(
  progress: SubagentToolProgress,
  input: AgentRunEventSource,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (progress.type === "planned") {
    return [
      {
        type: "subagent.planned",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          parentToolCallId: progress.parentToolCallId,
          tasks: progress.tasks
        }
      }
    ];
  }
  if (progress.type === "draw_updated") {
    const { type: _type, ...payload } = progress;
    return [
      {
        type: "subagent.draw_updated",
        runId: input.runId,
        sessionId: input.sessionId,
        payload
      }
    ];
  }
  const progressRuntime = progress.runtime ?? runtime;
  const base = {
    parentToolCallId: progress.parentToolCallId,
    subagentRunId: progress.subagentRunId,
    subagentId: progress.subagentId,
    name: progress.name,
    runtime: progressRuntime,
    ...(progress.draw ? { draw: progress.draw } : {})
  };
  if (progress.type === "started") {
    return [
      {
        type: "subagent.started",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          ...base,
          task: progress.task,
          ...(progress.batchTask ? { batchTask: progress.batchTask } : {})
        }
      }
    ];
  }
  if (progress.type === "activity") {
    return [
      {
        type: "subagent.activity",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: { ...base, activity: progress.activity }
      }
    ];
  }
  if (progress.type === "completed") {
    return [
      {
        type: "subagent.completed",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          ...base,
          status: progress.status,
          summary: progress.summary,
          ...(progress.errorMessage
            ? { errorMessage: progress.errorMessage }
            : {}),
          ...(progress.usage ? { usage: progress.usage } : {}),
          ...(progress.batchTask ? { batchTask: progress.batchTask } : {})
        }
      }
    ];
  }

  if (progress.type === "usage_observed") {
    return [
      {
        type: "agent.usage_observed",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          observationId: progress.observationId,
          observedAt: progress.observedAt,
          messageId: progress.messageId,
          turnId: progress.turnId,
          attempt: progress.attempt,
          status: progress.status,
          hadToolCall: progress.hadToolCall,
          usage: progress.usage,
          runtime: progress.runtime,
          parentToolCallId: progress.parentToolCallId,
          subagentRunId: progress.subagentRunId,
          subagentId: progress.subagentId
        }
      }
    ];
  }

  if (progress.type !== "child_tool_details") return [];

  // Child workspace mutations remain ordinary parent-run workspace events so
  // the existing review/approval chain can process them. Only their tool-call
  // id is namespaced to the ephemeral child run.
  return toRuntimeEvents(
    {
      type: "tool_execution_end",
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      result: progress.result,
      isError: progress.isError
    },
    input,
    progressRuntime,
    messageId
  )
    .map((event) =>
      event.type === "library.editor_mutation" && input.libraryManagement
        ? {
            ...event,
            payload: {
              ...event.payload,
              managementScope: input.libraryManagement.scope
            }
          }
        : event
    )
    .filter(
      (event) =>
        event.type === "library.editor_mutation" ||
        event.type === "extras_agent.output_updated" ||
        event.type === "workspace.editor_mutation" ||
        event.type === "workspace.stage_selection" ||
        event.type === "academic.workspace_mutation" ||
        event.type === "long.mutation_proposal" ||
        event.type === "long.worldbuilding_file_proposal" ||
        event.type === "long.character_file_proposal" ||
        event.type === "long.continuity_file_proposal" ||
        event.type === "long.chapter_write_proposal" ||
        event.type === "long.ledger_commit_proposal" ||
        event.type === "mystery.mutation_proposal"
    );
}
