import type {
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { agentApprovalCanDiscard } from "../utils/acceptedEditDiscard";

import { isWriteTool } from "./conversationToolStatus";
export {
  workspaceToolLabel,
  isWriteTool,
  writeToolAction,
  writeActionLabel,
  toolKind,
  toolIcon,
  toolLabel,
  toolGroupIsRunning,
  toolGroupLabel,
  toolDetail,
  writeToolContentLabel,
  writeToolTarget,
  visibleToolArguments,
  formatToolPayload
} from "./conversationToolStatus";

export function hasProcessing(message: ChatMessage): boolean {
  return processingItems(message).length > 0;
}

export function hasProcessingDisclosure(message: ChatMessage): boolean {
  return hasProcessing(message) || Boolean(message.subagentRuns?.length);
}

export function isSpawnSubagentTool(tool: AgentToolTrace): boolean {
  return tool.name === "spawn_subagent";
}

function hasSubagentRunForTool(
  message: ChatMessage,
  tool: AgentToolTrace
): boolean {
  return Boolean(
    isSpawnSubagentTool(tool) &&
    message.subagentRuns?.some((run) => run.parentToolCallId === tool.id)
  );
}

export type ProcessingItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "response"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string };

export type ApprovalCardItem =
  | {
      id: string;
      type: "edit-proposal";
      createdAt: string;
      toolCallIds: string[];
      canDiscard: boolean;
      proposal: AgentEditProposal;
    }
  | {
      id: string;
      type: "long-proposal";
      createdAt: string;
      toolCallIds: string[];
      item: LongWorkspaceProposalItem;
    };

export type ProcessingDisplayItem =
  | Exclude<ProcessingItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] }
  | ApprovalCardItem;

export function processingItems(message: ChatMessage): ProcessingItem[] {
  const items: ProcessingItem[] = [];
  if (message.processingSteps?.length) {
    let lastResponseIndex = -1;
    for (
      let index = message.processingSteps.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (message.processingSteps[index]?.type === "response") {
        lastResponseIndex = index;
        break;
      }
    }
    for (const [index, step] of message.processingSteps.entries()) {
      if (step.type === "thinking") {
        items.push({
          id: step.id,
          type: "thinking",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "response") {
        // While streaming every turn remains visible in arrival order. Once the
        // run ends, the last response moves outside the processed disclosure.
        if (message.status === "streaming" || index !== lastResponseIndex) {
          items.push({
            id: step.id,
            type: "response",
            content: step.content,
            createdAt: step.createdAt
          });
        }
        continue;
      }
      const tool = message.toolCalls?.find(
        (toolCall) => toolCall.id === step.toolCallId
      );
      if (tool && !hasSubagentRunForTool(message, tool)) {
        items.push({
          id: step.id,
          type: "tool",
          tool,
          createdAt: step.createdAt
        });
      }
    }
    return items;
  }
  if (message.thinking) {
    items.push({
      id: `${message.id}_thinking`,
      type: "thinking",
      content: message.thinking,
      createdAt: message.createdAt
    });
  }
  for (const tool of message.toolCalls ?? []) {
    if (!hasSubagentRunForTool(message, tool)) {
      items.push({
        id: `${message.id}_${tool.id}`,
        type: "tool",
        tool,
        createdAt: tool.requestedAt
      });
    }
  }
  return items;
}

function compareApprovalCards(
  left: ApprovalCardItem,
  right: ApprovalCardItem
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function longProposalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): LongWorkspaceProposalItem[] {
  if (!message.runId) return [];
  return longProposalItems.filter(
    (item) => item.event.payload.runId === message.runId
  );
}

export function approvalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): ApprovalCardItem[] {
  const editItems: ApprovalCardItem[] = (message.editProposals ?? []).map(
    (proposal) => ({
      id: `edit:${proposal.id}`,
      type: "edit-proposal",
      createdAt: proposal.createdAt,
      toolCallIds: proposal.toolCallIds,
      canDiscard: agentApprovalCanDiscard(message, proposal),
      proposal
    })
  );
  const longItems: ApprovalCardItem[] = longProposalItemsForMessage(
    message,
    longProposalItems
  ).map((item) => ({
    id: `long:${item.event.id}`,
    type: "long-proposal",
    createdAt: item.event.timestamp,
    toolCallIds: [item.event.payload.toolCallId],
    item
  }));
  return [...editItems, ...longItems].sort(compareApprovalCards);
}

export function liveTimelineItems(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): Array<ProcessingItem | ApprovalCardItem> {
  const processing = processingItems(message);
  const positioned: Array<{
    position: number;
    sequence: number;
    item: ProcessingItem | ApprovalCardItem;
  }> = processing.map((item, index) => ({
    position: index * 2,
    sequence: index,
    item
  }));

  for (const [approvalIndex, approval] of approvalItemsForMessage(
    message,
    longProposalItems
  ).entries()) {
    let anchorIndex = -1;
    for (const [index, item] of processing.entries()) {
      if (item.type === "tool" && approval.toolCallIds.includes(item.tool.id)) {
        anchorIndex = index;
      }
    }
    if (anchorIndex >= 0) {
      positioned.push({
        position: anchorIndex * 2 + 1,
        sequence: processing.length + approvalIndex,
        item: approval
      });
      continue;
    }
    const laterIndex = processing.findIndex(
      (item) => item.createdAt.localeCompare(approval.createdAt) > 0
    );
    positioned.push({
      position: laterIndex < 0 ? processing.length * 2 + 1 : laterIndex * 2 - 1,
      sequence: processing.length + approvalIndex,
      item: approval
    });
  }

  return positioned
    .sort((left, right) => {
      if (left.position !== right.position)
        return left.position - right.position;
      const leftApproval =
        left.item.type === "edit-proposal" ||
        left.item.type === "long-proposal";
      const rightApproval =
        right.item.type === "edit-proposal" ||
        right.item.type === "long-proposal";
      if (leftApproval && rightApproval) {
        return compareApprovalCards(
          left.item as ApprovalCardItem,
          right.item as ApprovalCardItem
        );
      }
      return left.sequence - right.sequence;
    })
    .map(({ item }) => item);
}

export function processingDisplayItems(
  message: ChatMessage,
  includeApprovalCards = false,
  longProposalItems: readonly LongWorkspaceProposalItem[] = []
): ProcessingDisplayItem[] {
  const displayItems: ProcessingDisplayItem[] = [];
  const timelineItems = includeApprovalCards
    ? liveTimelineItems(message, longProposalItems)
    : processingItems(message);
  for (const item of timelineItems) {
    if (item.type === "edit-proposal" || item.type === "long-proposal") {
      displayItems.push(item);
      continue;
    }
    if (item.type !== "tool" || isWriteTool(item.tool)) {
      displayItems.push(item);
      continue;
    }
    const previous = displayItems.at(-1);
    if (previous?.type === "tool-group") {
      previous.tools.push(item.tool);
      continue;
    }
    displayItems.push({
      id: `${item.id}_group`,
      type: "tool-group",
      tools: [item.tool]
    });
  }
  return displayItems;
}

function hasResponseSteps(message: ChatMessage): boolean {
  return (
    message.processingSteps?.some((step) => step.type === "response") ?? false
  );
}

export function visibleResponse(message: ChatMessage): string {
  if (message.status === "streaming" && hasResponseSteps(message)) return "";
  return message.content;
}

function retryProgress(
  message: ChatMessage
): { current: number; total: number } | undefined {
  if (!message.retry) return undefined;
  return {
    current: Math.max(1, message.retry.attempt - 1),
    total: Math.max(1, message.retry.maxAttempts - 1)
  };
}

export function retryStatusLabel(
  message: ChatMessage,
  now: number
): string | undefined {
  const retry = message.retry;
  const progress = retryProgress(message);
  if (!retry || !progress) return undefined;
  const suffix = `（第 ${progress.current}/${progress.total} 次）`;
  if (retry.state === "trying") return `正在重试${suffix}`;
  const retryAt = retry.retryAt ? Date.parse(retry.retryAt) : Number.NaN;
  const remainingSeconds = Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - now) / 1_000))
    : Math.max(0, Math.ceil((retry.delayMs ?? 0) / 1_000));
  return `网络波动，${remainingSeconds}s 后重试${suffix}`;
}

export function hasFirstModelOutput(message: ChatMessage): boolean {
  if (message.content || message.thinking) return true;
  if (message.toolCalls?.length || message.subagentRuns?.length) return true;
  return (
    message.processingSteps?.some(
      (step) =>
        step.type === "tool" ||
        ((step.type === "thinking" || step.type === "response") &&
          step.content.length > 0)
    ) ?? false
  );
}

export const MODEL_QUEUE_LABEL_DELAY_MS = 10_000;

export function processingLabel(message: ChatMessage, now: number): string {
  const retryLabel = retryStatusLabel(message, now);
  if (retryLabel) return retryLabel;
  const start = Date.parse(message.processingStartedAt ?? message.createdAt);
  const end = message.processingCompletedAt
    ? Date.parse(message.processingCompletedAt)
    : message.status === "streaming"
      ? now
      : start + 1_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return message.status === "streaming" ? "处理中" : "已处理";
  }
  const seconds = Math.max(1, Math.ceil((end - start) / 1_000));
  if (
    message.status === "streaming" &&
    end - start >= MODEL_QUEUE_LABEL_DELAY_MS &&
    !hasFirstModelOutput(message)
  ) {
    return `模型排队中 · 已等待 ${seconds}s`;
  }
  return `${message.status === "streaming" ? "处理中" : "已处理"} ${seconds}s`;
}
