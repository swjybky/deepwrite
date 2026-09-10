import type {
  AgentRuntimeRef,
  AgentUsage,
  AgentUsageObservationStatus
} from "@deepwrite/contracts";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentTurnAttempt } from "./agent-turn-retry";
import { isLearningImitationToolDetails } from "./learning-imitation-tools";
import { isLongBookAnalysisToolDetails } from "./long-book-analysis/tools";
import { isLibraryAgentToolDetails } from "./library-agent-tools";
import { isLongAgentToolDetails } from "./long-agent-tools";
import type { AgentRunInput, AgentRuntimeEvent } from "./runtime-types";
import { isShortWorkspaceToolDetails } from "./short-agent-tools";
import { isSubagentAuthoringToolDetails } from "./subagent-authoring-tools";
import { toSubagentRuntimeEvents } from "./subagent-events";
import { isSubagentToolProgressDetails } from "./subagent-runtime";
import type { ToolCallAssistantEvent } from "./tool-stream";

/** @internal Exported for protocol regression tests. */
export function toToolStreamRuntimeEvent(
  streamEvent: ToolCallAssistantEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string,
  assistantTurnIndex: number
): Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }> {
  const content = streamEvent.partial.content[streamEvent.contentIndex];
  const toolCall = content?.type === "toolCall" ? content : undefined;
  const argumentsSnapshot = toolCallArgumentsSnapshot(streamEvent, toolCall);
  const phase =
    streamEvent.type === "toolcall_start"
      ? "start"
      : streamEvent.type === "toolcall_delta"
        ? "delta"
        : "end";
  return {
    type: "agent.tool_stream",
    runId: input.runId,
    sessionId: input.sessionId,
    payload: {
      streamId: `${messageId}:${assistantTurnIndex}:${streamEvent.contentIndex}`,
      ...(toolCall?.id ? { toolCallId: toolCall.id } : {}),
      ...(toolCall?.name ? { toolName: toolCall.name } : {}),
      phase,
      argumentsDelta:
        streamEvent.type === "toolcall_delta" ? streamEvent.delta : "",
      ...(argumentsSnapshot !== undefined ? { argumentsSnapshot } : {}),
      ...(streamEvent.type === "toolcall_end"
        ? { args: streamEvent.toolCall.arguments }
        : {}),
      runtime
    }
  };
}

export function serializedToolArguments(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (Object.keys(value).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** @internal Exported for protocol regression tests. */
export function toolCallArgumentsSnapshot(
  streamEvent: ToolCallAssistantEvent,
  toolCall:
    | Extract<AssistantMessage["content"][number], { type: "toolCall" }>
    | undefined
): string | undefined {
  const providerToolCall = toolCall as
    | (typeof toolCall & { partialJson?: unknown; partialArgs?: unknown })
    | undefined;
  for (const candidate of [
    providerToolCall?.partialJson,
    providerToolCall?.partialArgs
  ]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  if (streamEvent.type === "toolcall_end") {
    return serializedToolArguments(streamEvent.toolCall.arguments);
  }
  if (streamEvent.type === "toolcall_start") {
    return serializedToolArguments(toolCall?.arguments);
  }
  return undefined;
}

/** @internal Exported for protocol regression tests. */
export function reconcileToolCallArguments(
  current: string,
  incomingDelta: string,
  snapshot?: string
): { delta: string; next: string } {
  let delta = incomingDelta;
  if (snapshot !== undefined) {
    if (snapshot.startsWith(current)) {
      delta = snapshot.slice(current.length);
    } else if (current.startsWith(snapshot)) {
      delta = "";
    } else if (!current) {
      delta = snapshot;
    }
  }
  return { delta, next: `${current}${delta}` };
}

/**
 * Converts one raw assistant terminal message into the internal accounting
 * event. This runs outside `toRuntimeEvents` because retryable failures are
 * intentionally withheld from the presentation event stream.
 *
 * @internal Exported for accounting protocol regression tests.
 */
export function toUsageObservedRuntimeEvent(
  message: AssistantMessage,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string,
  attempt: AgentTurnAttempt
): Extract<AgentRuntimeEvent, { type: "agent.usage_observed" }> | undefined {
  const usage = normalizeUsage(message.usage);
  if (!usage) return undefined;
  const status: AgentUsageObservationStatus =
    message.stopReason === "aborted"
      ? "aborted"
      : message.stopReason === "error" || message.errorMessage
        ? "error"
        : "completed";
  return {
    type: "agent.usage_observed",
    runId: input.runId,
    sessionId: input.sessionId,
    payload: {
      observationId: `${attempt.turnId}:attempt:${attempt.attempt}`,
      observedAt: new Date().toISOString(),
      messageId,
      turnId: attempt.turnId,
      attempt: attempt.attempt,
      status,
      hadToolCall: message.content.some((item) => item.type === "toolCall"),
      usage,
      runtime
    }
  };
}

/** @internal Exported for runtime event contract tests. */
export function toRuntimeEvents(
  event: AgentEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (event.type === "tool_execution_update") {
    const details = (event.partialResult as { details?: unknown } | undefined)
      ?.details;
    if (isSubagentToolProgressDetails(details)) {
      return toSubagentRuntimeEvents(
        details.progress,
        input,
        runtime,
        messageId
      );
    }
    return [];
  }

  if (event.type === "tool_execution_start") {
    return [
      {
        type: "agent.tool_requested",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          runtime
        }
      }
    ];
  }

  if (event.type === "tool_execution_end") {
    const events: AgentRuntimeEvent[] = [
      {
        type: "agent.tool_completed",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          resultSummary: summarizeToolResult(event.result),
          isError: event.isError,
          runtime
        }
      }
    ];
    const details = (event.result as { details?: unknown } | undefined)
      ?.details;
    if (isShortWorkspaceToolDetails(details)) {
      if (
        details.kind === "workspace-editor-mutation" ||
        details.kind === "workspace-character-file-mutation" ||
        details.kind === "workspace-character-structure-mutation" ||
        details.kind === "workspace-plot-structure-mutation" ||
        details.kind === "workspace-expert-draft-file-mutation" ||
        details.kind === "workspace-expert-draft-section-creation" ||
        details.kind === "workspace-expert-draft-section-rename" ||
        details.kind === "workspace-expert-draft-section-deletion"
      ) {
        const text =
          details.kind === "workspace-plot-structure-mutation"
            ? details.mutation.type === "create"
              ? details.mutation.content || `创建：${details.mutation.title}`
              : `${details.mutation.previousTitle} → ${details.mutation.title}\n${details.mutation.description}`
            : details.kind === "workspace-character-structure-mutation"
              ? details.mutation.type === "deleteItem"
                ? details.mutation.deletedText
                : details.mutation.type === "updateItem"
                  ? `${details.mutation.previousTitle} → ${details.mutation.title}`
                  : details.mutation.type === "moveItem"
                    ? `${details.mutation.title}：${details.mutation.direction === "up" ? "上移" : "下移"}`
                    : `创建：${details.mutation.title}`
              : details.kind === "workspace-expert-draft-section-creation"
                ? details.sections
                    .map(
                      (section, index) =>
                        `${index + 1}. ${section.title}${section.wordCountRequirement ? `（${section.wordCountRequirement}）` : ""}`
                    )
                    .join("\n")
                : details.kind === "workspace-expert-draft-section-rename"
                  ? `${details.previousTitle} → ${details.title}`
                  : details.kind === "workspace-expert-draft-section-deletion"
                    ? `删除：${details.title}`
                    : details.text;
        events.push({
          type: "workspace.editor_mutation",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            workspaceId: details.workspaceId,
            stageId: details.stageId,
            text,
            ...(details.kind === "workspace-expert-draft-file-mutation"
              ? {
                  mutationTarget: {
                    kind: "expert-draft-file" as const,
                    documentId: details.documentId,
                    sectionId: details.sectionId,
                    fileKind: details.fileKind
                  }
                }
              : details.kind === "workspace-character-file-mutation"
                ? {
                    mutationTarget: {
                      kind: "character-file" as const,
                      documentId: details.documentId,
                      ...(details.itemId ? { itemId: details.itemId } : {})
                    }
                  }
                : details.kind === "workspace-character-structure-mutation"
                  ? {
                      mutationTarget: {
                        kind: "character-structure" as const,
                        mutation: details.mutation,
                        ...(details.initialContent
                          ? { initialContent: details.initialContent }
                          : {})
                      }
                    }
                  : details.kind === "workspace-plot-structure-mutation"
                    ? {
                        mutationTarget: {
                          kind: "plot-structure" as const,
                          mutation: details.mutation
                        }
                      }
                    : details.kind === "workspace-expert-draft-section-creation"
                      ? {
                          mutationTarget: {
                            kind: "expert-draft-section-creation" as const,
                            sections: details.sections,
                            ...(details.afterSectionId
                              ? { afterSectionId: details.afterSectionId }
                              : {})
                          }
                        }
                      : details.kind === "workspace-expert-draft-section-rename"
                        ? {
                            mutationTarget: {
                              kind: "expert-draft-section-rename" as const,
                              sectionId: details.sectionId,
                              previousTitle: details.previousTitle,
                              title: details.title
                            }
                          }
                        : details.kind ===
                            "workspace-expert-draft-section-deletion"
                          ? {
                              mutationTarget: {
                                kind: "expert-draft-section-deletion" as const,
                                sectionId: details.sectionId,
                                title: details.title
                              }
                            }
                          : {}),
            baseRevision: details.baseRevision,
            summary: details.summary,
            runtime
          }
        });
      } else if (details.kind === "workspace-stage-selection") {
        events.push({
          type: "workspace.stage_selection",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            workspaceId: details.workspaceId,
            stageId: details.stageId,
            runtime
          }
        });
      }
    } else if (
      isLibraryAgentToolDetails(details) &&
      (details.kind === "library-entry-mutation" ||
        details.kind === "library-overview-mutation")
    ) {
      events.push({
        type: "library.editor_mutation",
        runId: input.runId,
        sessionId: input.sessionId,
        payload:
          details.kind === "library-overview-mutation"
            ? {
                toolCallId: event.toolCallId,
                operation: details.operation,
                domain: details.domain,
                libraryId: details.libraryId,
                documentId: details.documentId,
                title: details.title,
                text: details.text,
                baseRevision: details.baseRevision,
                ...(details.baseProjectRevision === undefined
                  ? {}
                  : { baseProjectRevision: details.baseProjectRevision }),
                summary: details.summary,
                runtime
              }
            : details.operation === "create"
              ? {
                  toolCallId: event.toolCallId,
                  operation: details.operation,
                  ...(details.creationId
                    ? { creationId: details.creationId }
                    : {}),
                  domain: details.domain,
                  libraryId: details.libraryId,
                  stageId: details.stageId,
                  title: details.title,
                  text: details.text,
                  baseRevision: details.baseRevision,
                  ...(details.baseProjectRevision === undefined
                    ? {}
                    : { baseProjectRevision: details.baseProjectRevision }),
                  summary: details.summary,
                  runtime
                }
              : {
                  toolCallId: event.toolCallId,
                  operation: details.operation,
                  domain: details.domain,
                  libraryId: details.libraryId,
                  entryId: details.entryId,
                  documentId: details.documentId,
                  stageId: details.stageId,
                  title: details.title,
                  text: details.text,
                  baseRevision: details.baseRevision,
                  ...(details.baseProjectRevision === undefined
                    ? {}
                    : { baseProjectRevision: details.baseProjectRevision }),
                  summary: details.summary,
                  runtime
                }
      });
    } else if (isLearningImitationToolDetails(details)) {
      events.push({
        type: "learning_imitation.result_updated",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          toolCallId: event.toolCallId,
          stageId: details.stageId,
          update: details.update,
          runtime
        }
      });
    } else if (isLongBookAnalysisToolDetails(details)) {
      events.push(
        details.kind === "long-book-analysis-note"
          ? {
              type: "long_book_analysis.note_updated",
              runId: input.runId,
              sessionId: input.sessionId,
              payload: {
                toolCallId: event.toolCallId,
                jobId: details.jobId,
                unitId: details.unitId,
                note: details.note,
                runtime
              }
            }
          : {
              type: "long_book_analysis.result_updated",
              runId: input.runId,
              sessionId: input.sessionId,
              payload: {
                toolCallId: event.toolCallId,
                jobId: details.jobId,
                unitId: details.unitId,
                result: details.result,
                runtime
              }
            }
      );
    } else if (isSubagentAuthoringToolDetails(details)) {
      events.push({
        type: "subagent_authoring.draft_updated",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          toolCallId: event.toolCallId,
          draft: details.draft,
          runtime
        }
      });
    } else if (isLongAgentToolDetails(details)) {
      if (details.kind === "long-mutation-proposal") {
        events.push({
          type: "long.mutation_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            batch: details.batch,
            summary: details.summary,
            runtime
          }
        });
      } else if (details.kind === "long-worldbuilding-file-proposal") {
        events.push({
          type: "long.worldbuilding_file_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            batch: details.batch,
            summary: details.summary,
            files: details.files,
            runtime
          }
        });
      } else if (details.kind === "long-character-file-proposal") {
        events.push({
          type: "long.character_file_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            batch: details.batch,
            summary: details.summary,
            files: details.files,
            runtime
          }
        });
      } else if (details.kind === "long-continuity-file-proposal") {
        events.push({
          type: "long.continuity_file_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            batch: details.batch,
            summary: details.summary,
            files: details.files,
            runtime
          }
        });
      } else if (details.kind === "long-chapter-write-proposal") {
        events.push({
          type: "long.chapter_write_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            batch: details.batch,
            file: details.file,
            summary: details.summary,
            runtime
          }
        });
      } else if (details.kind === "long-ledger-commit-proposal") {
        events.push({
          type: "long.ledger_commit_proposal",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            bookId: details.bookId,
            agentId: details.agentId,
            input: details.input,
            summary: details.summary,
            runtime
          }
        });
      }
    }
    return events;
  }

  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      return [
        {
          type: "agent.delta",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: { messageId, delta: streamEvent.delta, runtime }
        }
      ];
    }
    if (streamEvent.type === "thinking_delta") {
      return [
        {
          type: "agent.thinking_delta",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: { messageId, delta: streamEvent.delta, runtime }
        }
      ];
    }
  }

  if (event.type === "message_end" && isAssistantMessage(event.message)) {
    if (
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted" ||
      event.message.errorMessage
    ) {
      return [
        {
          type: "agent.error",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            code:
              event.message.stopReason === "aborted"
                ? "pi_agent.aborted"
                : "pi_agent.provider_error",
            message:
              event.message.errorMessage ??
              (event.message.stopReason === "aborted"
                ? "智能体运行已中止。"
                : "模型返回错误终态。"),
            runtime
          }
        }
      ];
    }

    if (event.message.content.some((item) => item.type === "toolCall")) {
      return [];
    }

    const thinking = readAssistantThinking(event.message);
    const usage = normalizeUsage(event.message.usage);
    return [
      {
        type: "agent.completed",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          messageId,
          content: readAssistantText(event.message),
          ...(thinking ? { thinking } : {}),
          ...(event.message.stopReason
            ? { stopReason: event.message.stopReason }
            : {}),
          ...(usage ? { usage } : {}),
          runtime
        }
      }
    ];
  }

  return [];
}

export function isAssistantMessage(
  message: AgentMessage
): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    message.role === "assistant"
  );
}

export function readAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

export function readAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("\n\n");
}

export function summarizeToolResult(result: unknown): string {
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (item): item is { type: "text"; text: string } =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string"
        )
        .map((item) => item.text)
        .join("\n");
      if (text) {
        return text.slice(0, 4_000);
      }
    }
  }
  if (result === undefined || result === null) {
    return "工具执行完成。";
  }
  try {
    const summary = JSON.stringify(result);
    return summary ? summary.slice(0, 4_000) : "工具执行完成。";
  } catch {
    return "工具已执行完成。";
  }
}

export function normalizeUsage(
  usage: Usage | undefined
): AgentUsage | undefined {
  if (!usage) return undefined;
  const values = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens
  };
}
