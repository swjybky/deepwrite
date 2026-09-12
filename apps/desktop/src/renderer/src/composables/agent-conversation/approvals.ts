import type { AgentConversationContext } from "./context";
import { cloneEditProposal } from "./clone";
import type {
  AgentApprovalMode,
  AgentEditProposal,
  ChatMessage
} from "../../types/conversation";
import { id } from "./shared";

type ApprovalsContext = Pick<
  AgentConversationContext,
  | "sessionId"
  | "finishedRunIds"
  | "activeRunId"
  | "pendingAttemptId"
  | "observedRunByAttempt"
  | "approvalModeByRun"
  | "approvalModeByAttempt"
  | "rememberRunApprovalMode"
  | "runMessageIds"
  | "messages"
  | "messageForEditProposal"
  | "ensureEditProposalMessage"
>;
export function acceptsRunEvent(
  ctx: ApprovalsContext,
  eventSessionId: string,
  runId: string
): boolean {
  if (eventSessionId !== ctx.sessionId.value || ctx.finishedRunIds.has(runId)) {
    return false;
  }
  if (ctx.activeRunId.value) {
    return ctx.activeRunId.value === runId;
  }
  if (ctx.pendingAttemptId.value === null) {
    return false;
  }
  const observedRunId = ctx.observedRunByAttempt.get(
    ctx.pendingAttemptId.value
  );
  return observedRunId === undefined || observedRunId === runId;
}
export function rememberRunApprovalMode(
  ctx: ApprovalsContext,
  runId: string,
  mode: AgentApprovalMode
): void {
  ctx.approvalModeByRun.set(runId, mode);
  while (ctx.approvalModeByRun.size > 2000) {
    const oldest = ctx.approvalModeByRun.keys().next().value as
      string | undefined;
    if (!oldest) break;
    ctx.approvalModeByRun.delete(oldest);
  }
}
export function approvalModeForRun(
  ctx: ApprovalsContext,
  eventSessionId: string,
  runId: string
): AgentApprovalMode | undefined {
  if (eventSessionId !== ctx.sessionId.value) return undefined;
  const knownMode = ctx.approvalModeByRun.get(runId);
  if (knownMode) return knownMode;
  const attemptId = ctx.pendingAttemptId.value;
  if (attemptId === null) return undefined;
  const observedRunId = ctx.observedRunByAttempt.get(attemptId);
  if (observedRunId && observedRunId !== runId) return undefined;
  const pendingMode = ctx.approvalModeByAttempt.get(attemptId);
  if (pendingMode) ctx.rememberRunApprovalMode(runId, pendingMode);
  return pendingMode;
}
export function markToolConflict(
  ctx: ApprovalsContext,
  runId: string,
  toolCallId: string,
  summary: string
): void {
  const messageId = ctx.runMessageIds.get(runId) ?? `${runId}_assistant`;
  const message = ctx.messages.value.find(
    (candidate) =>
      candidate.id === messageId &&
      candidate.role === "assistant" &&
      candidate.runId === runId
  );
  const tool = message?.tools?.find((candidate) => candidate.id === toolCallId);
  if (tool) {
    tool.status = "error";
    tool.summary = summary;
  }
  const toolCall = message?.toolCalls?.find(
    (candidate) => candidate.id === toolCallId
  );
  if (toolCall) {
    toolCall.status = "error";
    toolCall.resultSummary = summary;
    toolCall.isError = true;
  }
  for (const subagentRun of message?.subagentRuns ?? []) {
    const subagentToolCall = subagentRun.toolCalls.find(
      (candidate) => candidate.id === toolCallId
    );
    if (!subagentToolCall) continue;
    subagentToolCall.status = "error";
    subagentToolCall.completedAt ??= new Date().toISOString();
    subagentToolCall.resultSummary = summary;
    subagentToolCall.isError = true;
  }
}
export function messageForEditProposal(
  ctx: ApprovalsContext,
  runId: string
): ChatMessage | undefined {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  const mapped = mappedMessageId
    ? ctx.messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId
      )
    : undefined;
  return (
    mapped ??
    ctx.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    )
  );
}
export function ensureEditProposalMessage(
  ctx: ApprovalsContext,
  runId: string,
  createdAt: string
): ChatMessage {
  const existing = ctx.messageForEditProposal(runId);
  if (existing) return existing;
  const preferredId = `${runId}_assistant`;
  const message: ChatMessage = {
    id: ctx.messages.value.some((candidate) => candidate.id === preferredId)
      ? `${preferredId}_${id("proposal")}`
      : preferredId,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: ctx.activeRunId.value === runId ? "streaming" : "completed",
    activityOnly: true,
    editProposals: []
  };
  ctx.messages.value.push(message);
  ctx.runMessageIds.set(runId, message.id);
  return ctx.messages.value.find((candidate) => candidate.id === message.id)!;
}
export function getEditProposal(
  ctx: ApprovalsContext,
  runId: string,
  proposalId: string
): AgentEditProposal | undefined {
  const proposal = ctx
    .messageForEditProposal(runId)
    ?.editProposals?.find((candidate) => candidate.id === proposalId);
  return proposal ? cloneEditProposal(proposal) : undefined;
}
export function listEditProposals(
  ctx: ApprovalsContext,
  runId: string
): AgentEditProposal[] {
  return (ctx.messageForEditProposal(runId)?.editProposals ?? []).map(
    cloneEditProposal
  );
}
export function upsertEditProposal(
  ctx: ApprovalsContext,
  runId: string,
  proposal: AgentEditProposal
): AgentEditProposal {
  const normalized = cloneEditProposal({ ...proposal, runId });
  const message = ctx.ensureEditProposalMessage(runId, normalized.createdAt);
  const proposals = message.editProposals ?? [];
  const existingIndex = proposals.findIndex(
    (candidate) => candidate.id === normalized.id
  );
  if (existingIndex >= 0) {
    proposals[existingIndex] = normalized;
    message.editProposals = proposals;
  } else {
    message.editProposals = [...proposals, normalized];
  }
  return cloneEditProposal(normalized);
}
export function updateEditProposal(
  ctx: ApprovalsContext,
  runId: string,
  proposalId: string,
  patch: Partial<AgentEditProposal>
): AgentEditProposal | undefined {
  const message = ctx.messageForEditProposal(runId);
  const proposalIndex =
    message?.editProposals?.findIndex(
      (candidate) => candidate.id === proposalId
    ) ?? -1;
  if (!message?.editProposals || proposalIndex < 0) return undefined;
  const existing = message.editProposals[proposalIndex]!;
  const next = cloneEditProposal({
    ...existing,
    ...patch,
    id: existing.id,
    runId: existing.runId,
    updatedAt: patch.updatedAt ?? new Date().toISOString()
  });
  message.editProposals[proposalIndex] = next;
  return cloneEditProposal(next);
}
