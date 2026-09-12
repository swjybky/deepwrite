import { AgentEvaluationSnapshotSchema } from "@deepwrite/contracts/renderer";
import type {
  AgentEditProposal,
  AgentSubagentRun,
  AgentToolTrace,
  ChatMessage
} from "../../types/conversation";
import { isRecord, nonnegativeInteger, validDate } from "./shared";
import { parseStoredEditProposal } from "./parse-proposal";
import {
  parseStoredRuntime,
  parseStoredUsage,
  parseStoredToolTrace
} from "./parse-runtime";
import { parseStoredSubagentRun } from "./parse-subagent";
export function parseStoredMessage(value: unknown): ChatMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    !validDate(value.createdAt)
  ) {
    return undefined;
  }

  const status = ["streaming", "completed", "stopped", "error"].includes(
    String(value.status)
  )
    ? (value.status as ChatMessage["status"])
    : undefined;
  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    ...(status ? { status: status === "streaming" ? "stopped" : status } : {})
  };
  const runtime = parseStoredRuntime(value.runtime);
  const usage = parseStoredUsage(value.usage);
  if (runtime) message.runtime = runtime;
  if (usage) message.usage = usage;

  if (Array.isArray(value.attachments)) {
    message.attachments = value.attachments.flatMap((attachment) => {
      if (
        !isRecord(attachment) ||
        typeof attachment.id !== "string" ||
        typeof attachment.name !== "string" ||
        (attachment.kind !== "text" && attachment.kind !== "image") ||
        typeof attachment.mediaType !== "string" ||
        !nonnegativeInteger(attachment.size)
      ) {
        return [];
      }
      return [
        {
          id: attachment.id,
          name: attachment.name,
          kind: attachment.kind,
          mediaType: attachment.mediaType,
          size: attachment.size,
          ...(attachment.truncated === true ? { truncated: true } : {})
        }
      ];
    });
  }

  for (const key of [
    "runId",
    "thinking",
    "processingStartedAt",
    "processingCompletedAt",
    "errorMessage"
  ] as const) {
    if (typeof value[key] === "string") {
      message[key] = value[key];
    }
  }
  if (value.activityOnly === true) message.activityOnly = true;

  if (value.evaluationSnapshot !== undefined) {
    const parsedEvaluation = AgentEvaluationSnapshotSchema.safeParse(
      value.evaluationSnapshot
    );
    if (parsedEvaluation.success) {
      message.evaluationSnapshot = parsedEvaluation.data;
    }
  }

  if (Array.isArray(value.tools)) {
    message.tools = value.tools.flatMap((tool) => {
      if (
        !isRecord(tool) ||
        typeof tool.id !== "string" ||
        typeof tool.name !== "string" ||
        !["running", "completed", "error"].includes(String(tool.status))
      ) {
        return [];
      }
      return [
        {
          id: tool.id,
          name: tool.name,
          status: tool.status as "running" | "completed" | "error",
          ...(typeof tool.summary === "string" ? { summary: tool.summary } : {})
        }
      ];
    });
  }

  if (Array.isArray(value.toolCalls)) {
    message.toolCalls = value.toolCalls
      .map(parseStoredToolTrace)
      .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  }

  if (Array.isArray(value.processingSteps)) {
    const processingSteps: NonNullable<ChatMessage["processingSteps"]> = [];
    for (const step of value.processingSteps) {
      if (
        !isRecord(step) ||
        typeof step.id !== "string" ||
        typeof step.createdAt !== "string"
      ) {
        continue;
      }
      if (step.type === "thinking" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "thinking",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "response" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "response",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "tool" && typeof step.toolCallId === "string") {
        processingSteps.push({
          id: step.id,
          type: "tool",
          toolCallId: step.toolCallId,
          createdAt: step.createdAt
        });
      }
    }
    message.processingSteps = processingSteps;
  }

  if (Array.isArray(value.subagentRuns)) {
    message.subagentRuns = value.subagentRuns
      .map(parseStoredSubagentRun)
      .filter((run): run is AgentSubagentRun => run !== undefined);
  }

  if (Array.isArray(value.editProposals)) {
    const editProposals = value.editProposals
      .map(parseStoredEditProposal)
      .filter(
        (proposal): proposal is AgentEditProposal => proposal !== undefined
      );
    if (
      editProposals.length !== value.editProposals.length ||
      editProposals.some((proposal) => proposal.runId !== message.runId)
    ) {
      return undefined;
    }
    message.editProposals = editProposals;
  }

  if (
    message.status === "stopped" &&
    message.processingStartedAt &&
    !message.processingCompletedAt
  ) {
    message.processingCompletedAt = new Date().toISOString();
  }
  return message;
}
