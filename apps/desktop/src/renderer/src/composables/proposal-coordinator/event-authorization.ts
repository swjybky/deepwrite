import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type { AgentApprovalMode } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import type { LongWorkspaceProposalEvent } from "../useLongWorkspaceProposals";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";

type LongChapterWriteProposalEvent = Extract<
  SystemEventEnvelope,
  { type: "long.chapter_write_proposal" }
>;
type LongProposalEvent =
  LongWorkspaceProposalEvent | LongChapterWriteProposalEvent;

interface AuthorizedProposalEvent {
  conversation: AgentConversationController;
  sessionId: string;
  runId: string;
  bookId?: string;
  approvalMode: AgentApprovalMode;
}

const LONG_PROPOSAL_EVENT_TYPES = new Set<string>([
  "long.mutation_proposal",
  "long.worldbuilding_file_proposal",
  "long.character_file_proposal",
  "long.chapter_write_proposal"
]);

const authorizedEvents = new WeakMap<object, AuthorizedProposalEvent>();

/**
 * Captures the active conversation and approval mode synchronously when a
 * proposal event reaches the renderer so fast quota-exhausted failures do not
 * hide or drop proposals still waiting on async coordinator or file loads.
 */
export function authorizeProposalEvent(
  context: ProposalCoordinatorContext,
  event: unknown
): void {
  if (!event || typeof event !== "object" || !("payload" in event)) return;
  if (authorizedEvents.has(event)) return;
  const payload = (event as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return;
  const { sessionId, runId, bookId } = payload as {
    sessionId?: unknown;
    runId?: unknown;
    bookId?: unknown;
  };
  if (typeof sessionId !== "string" || typeof runId !== "string") return;
  const type = (event as { type?: unknown }).type;
  const isLong =
    typeof type === "string" && LONG_PROPOSAL_EVENT_TYPES.has(type);
  const conversation = isLong
    ? context.conversations?.forLongProposal?.(event as LongProposalEvent)
    : context.conversations
        ?.all?.()
        .find((item) => item.acceptsRunEvent(sessionId, runId));
  if (!conversation) return;
  authorizedEvents.set(event, {
    conversation,
    sessionId,
    runId,
    ...(typeof bookId === "string" ? { bookId } : {}),
    approvalMode:
      conversation.approvalModeForRun?.(sessionId, runId) ?? "request-approval"
  });
}

export function isShortProposalConversationActive(
  context: ProposalCoordinatorContext,
  conversation: AgentConversationController,
  sessionId: string
): boolean {
  const conversations = context.conversations?.all?.();
  if (conversations && !conversations.includes(conversation)) {
    return false;
  }
  return (
    conversation.sessionId === undefined ||
    conversation.sessionId.value === sessionId
  );
}

export function isLongProposalConversationActive(
  context: ProposalCoordinatorContext,
  conversation: AgentConversationController,
  bookId: string,
  sessionId: string
): boolean {
  if (
    conversation.sessionId !== undefined &&
    conversation.sessionId.value !== sessionId
  ) {
    return false;
  }
  const prefix = `long:${encodeURIComponent(bookId)}:`;
  const entries = [...(context.conversations?.byKey?.entries?.() ?? [])].filter(
    ([key]) => key.startsWith(prefix)
  );
  if (entries.length > 0) {
    return entries.some(([, candidate]) => candidate === conversation);
  }
  const all = context.conversations?.all?.();
  if (all?.length) {
    return all.includes(conversation);
  }
  return true;
}

export function resolveShortProposalConversation(
  context: ProposalCoordinatorContext,
  event: { payload: { sessionId: string; runId: string } }
): AgentConversationController | undefined {
  const active = context.conversations
    .all()
    .find((item) =>
      item.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
  if (active) return active;
  const authorized = authorizedEvents.get(event);
  if (
    !authorized ||
    authorized.sessionId !== event.payload.sessionId ||
    authorized.runId !== event.payload.runId
  ) {
    return undefined;
  }
  return isShortProposalConversationActive(
    context,
    authorized.conversation,
    authorized.sessionId
  )
    ? authorized.conversation
    : undefined;
}

export function resolveLongProposalConversation(
  context: ProposalCoordinatorContext,
  event: LongProposalEvent
): AgentConversationController | undefined {
  const active = context.conversations.forLongProposal(event);
  if (active) return active;
  const authorized = authorizedEvents.get(event);
  if (
    !authorized ||
    authorized.sessionId !== event.payload.sessionId ||
    authorized.runId !== event.payload.runId
  ) {
    return undefined;
  }
  return isLongProposalConversationActive(
    context,
    authorized.conversation,
    event.payload.bookId,
    authorized.sessionId
  )
    ? authorized.conversation
    : undefined;
}

export function resolveProposalApprovalMode(
  conversation: AgentConversationController,
  event: { payload: { sessionId: string; runId: string } }
): AgentApprovalMode {
  return (
    authorizedEvents.get(event)?.approvalMode ??
    conversation.approvalModeForRun?.(
      event.payload.sessionId,
      event.payload.runId
    ) ??
    "request-approval"
  );
}
