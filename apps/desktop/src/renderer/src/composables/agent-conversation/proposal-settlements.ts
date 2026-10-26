import type {
  ProposalSettlement,
  ProposalSettlementStatus,
  ProposalSettlements
} from "@deepwrite/contracts";
import {
  PROPOSAL_SETTLEMENT_MAX_ITEMS,
  PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH,
  PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH
} from "@deepwrite/contracts/renderer";
import type { AgentEditProposal, ChatMessage } from "../../types/conversation";

function settlementStatus(
  proposal: AgentEditProposal
): ProposalSettlementStatus | undefined {
  if (proposal.discardState?.status === "discarded") return "reverted";
  switch (proposal.status) {
    case "accepted":
      return "saved";
    case "rejected":
      return "rejected";
    case "conflict":
      return "conflict";
    case "error":
      return "failed";
    default:
      return undefined;
  }
}

function time(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function clip(value: string | undefined, limit: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, limit) : undefined;
}

/** Editing stays open during runs; tell the agent the user's version won. */
function concurrentEditDetail(
  proposal: AgentEditProposal,
  status: ProposalSettlementStatus
): string | undefined {
  const resolution = proposal.staleBase?.resolution;
  if (status === "rejected" && resolution === "kept-user") {
    return "用户在你修改期间编辑了该文档，选择保留自己的版本。";
  }
  if (status === "saved" && resolution === "overwrote") {
    return "用户在你修改期间编辑过该文档，确认用你的版本覆盖。";
  }
  return undefined;
}

function toSettlement(
  proposal: AgentEditProposal,
  status: ProposalSettlementStatus
): ProposalSettlement {
  const title =
    clip(proposal.title, PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH) ?? "未命名修改";
  // Card wording such as "等待用户审阅" would contradict the reported outcome.
  const summary = clip(
    proposal.summary.replace(/[，,]?\s*等待用户审阅。?$/u, ""),
    PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH
  );
  const detail =
    status === "conflict" || status === "failed"
      ? clip(proposal.statusMessage, PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH)
      : concurrentEditDetail(proposal, status);
  return {
    title,
    status,
    ...(summary && summary !== title ? { summary } : {}),
    ...(detail ? { detail } : {})
  };
}

/**
 * Outcomes of agent proposals settled after the previous user turn, for the
 * next `session.prompt`. The agent cannot see approval cards, so this is how
 * it learns what its writes became. Sending waits until no proposal is
 * pending, so `messages` (everything before the new user message) holds only
 * final states here.
 */
export function collectProposalSettlements(
  messages: readonly ChatMessage[]
): ProposalSettlements | undefined {
  let since = Number.NEGATIVE_INFINITY;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") {
      since = time(message.createdAt);
      break;
    }
  }
  const items: ProposalSettlement[] = [];
  let total = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const proposal of message.editProposals ?? []) {
      const status = settlementStatus(proposal);
      const settledAt = Math.max(
        time(proposal.updatedAt),
        time(proposal.discardState?.updatedAt)
      );
      if (!status || settledAt <= since) continue;
      total += 1;
      if (items.length < PROPOSAL_SETTLEMENT_MAX_ITEMS) {
        items.push(toSettlement(proposal, status));
      }
    }
  }
  if (!items.length) return undefined;
  return {
    items,
    ...(total > items.length ? { omittedCount: total - items.length } : {})
  };
}
