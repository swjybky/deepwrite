import { unwrapMessageValue } from "./message-mutations";
import { toRaw } from "vue";
import { AgentEvaluationSnapshotSchema } from "@deepwrite/contracts";
import type {
  AgentEditProposal,
  AgentSubagentRun,
  AgentTextDiffHunk,
  AgentTextDiffLine,
  ChatMessage
} from "../../types/conversation";

export function cloneTextDiffLine(line: AgentTextDiffLine): AgentTextDiffLine {
  line = toRaw(line);
  return { ...line };
}

export function cloneTextDiffHunk(hunk: AgentTextDiffHunk): AgentTextDiffHunk {
  hunk = toRaw(hunk);
  return {
    ...hunk,
    lines: hunk.lines.map(cloneTextDiffLine)
  };
}

export function cloneJsonRecord<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(toRaw(value))) as Value;
}

export function cloneEditProposal(
  proposal: AgentEditProposal
): AgentEditProposal {
  try {
    return cloneJsonRecord(proposal);
  } catch {
    proposal = toRaw(proposal);
    return {
      ...proposal,
      toolCallIds: [...proposal.toolCallIds],
      hunks: proposal.hunks.map(cloneTextDiffHunk)
    };
  }
}

export function cloneSubagentRun(run: AgentSubagentRun): AgentSubagentRun {
  run = toRaw(run);
  return {
    ...run,
    runtime: { ...run.runtime },
    ...(run.retry ? { retry: { ...run.retry } } : {}),
    ...(run.usage ? { usage: { ...run.usage } } : {}),
    toolCalls: run.toolCalls.map((toolCall) => ({ ...toolCall })),
    processingSteps: run.processingSteps.map((step) => ({ ...step }))
  };
}

export function cloneJsonValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}

export function cloneEvaluationSnapshot(
  snapshot: ChatMessage["evaluationSnapshot"]
): ChatMessage["evaluationSnapshot"] | undefined {
  if (!snapshot) return undefined;
  try {
    const parsed = AgentEvaluationSnapshotSchema.safeParse(
      cloneJsonValue(toRaw(snapshot))
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function cloneMessage(message: ChatMessage): ChatMessage {
  message = unwrapMessageValue(message);
  const evaluationSnapshot = cloneEvaluationSnapshot(
    message.evaluationSnapshot
  );
  const { evaluationSnapshot: _ignored, ...rest } = message;
  return {
    ...rest,
    ...(evaluationSnapshot ? { evaluationSnapshot } : {}),
    ...(message.retry ? { retry: { ...message.retry } } : {}),
    ...(message.attachments
      ? {
          attachments: message.attachments.map((attachment) => ({
            ...attachment
          }))
        }
      : {}),
    ...(message.tools
      ? { tools: message.tools.map((tool) => ({ ...tool })) }
      : {}),
    ...(message.toolCalls
      ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
      : {}),
    ...(message.processingSteps
      ? {
          processingSteps: message.processingSteps.map((step) => ({ ...step }))
        }
      : {}),
    ...(message.subagentRuns
      ? {
          subagentRuns: message.subagentRuns.map(cloneSubagentRun)
        }
      : {}),
    ...(message.editProposals
      ? { editProposals: message.editProposals.map(cloneEditProposal) }
      : {})
  };
}

export function cloneMessageForPersistence(message: ChatMessage): ChatMessage {
  const cloned = cloneMessage(message);
  // Durable conversation history is an observation log. `streaming` only
  // exists in the live UI; restore already treats it as stopped.
  if (cloned.status === "streaming") {
    cloned.status = "stopped";
  }
  return cloned;
}
