import {
  computed,
  effectScope,
  shallowReactive,
  shallowRef,
  watch,
  type Ref
} from "vue";
import type {
  AgentUserInputRequestedPayload,
  AgentWriteApprovalResponse,
  AgentWriteApprovalResult,
  ProposalSettlementStatus
} from "@deepwrite/contracts";
import {
  PROPOSAL_SETTLEMENT_MAX_ITEMS,
  PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH,
  WRITE_APPROVAL_QUESTION_ID
} from "@deepwrite/contracts/renderer";
import type { ChatMessage } from "../../types/conversation";
import type { AgentUserInputController } from "./user-input";
import { settlementStatus, toSettlement } from "./proposal-settlements";

/** One proposal the paused run waits for; `waiting` still needs the user. */
export interface WriteApprovalItem {
  key: string;
  state: "waiting" | ProposalSettlementStatus;
  result: Omit<AgentWriteApprovalResult, "status">;
  /** Conversation edit proposals, which the waiting card can review in bulk. */
  review?: { runId: string; proposalId: string; reviewable: boolean };
}

export type WriteApprovalRequest = AgentUserInputRequestedPayload & {
  writeApproval: NonNullable<AgentUserInputRequestedPayload["writeApproval"]>;
};

/**
 * Proposals outside conversation messages (the long-form review queue)
 * report through a source; an item that disappears was rejected.
 */
export type WriteApprovalSource = (
  request: WriteApprovalRequest
) => WriteApprovalItem[];

const sources = shallowReactive(new Set<WriteApprovalSource>());

export function registerWriteApprovalSource(
  source: WriteApprovalSource
): () => void {
  sources.add(source);
  return () => sources.delete(source);
}

export function clipWriteApprovalTitle(title: string): string {
  return title.trim().slice(0, PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH) || "—";
}

function proposalItems(
  messages: readonly ChatMessage[],
  request: WriteApprovalRequest
): WriteApprovalItem[] {
  const toolCallIds = new Set(request.writeApproval.toolCallIds);
  const items: WriteApprovalItem[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const proposal of message.editProposals ?? []) {
      if (
        proposal.runId !== request.runId ||
        !proposal.toolCallIds.some((id) => toolCallIds.has(id))
      )
        continue;
      // A failed save still waits: the user retries it or rejects it.
      const status =
        proposal.status === "error" ? undefined : settlementStatus(proposal);
      const { status: _status, ...settlement } = toSettlement(
        proposal,
        status ?? "saved"
      );
      const edited =
        status === "saved" && proposal.userEditedText !== undefined;
      items.push({
        key: `proposal:${proposal.id}`,
        state: status ?? "waiting",
        result: {
          ...settlement,
          toolCallIds: proposal.toolCallIds.filter((id) => toolCallIds.has(id)),
          ...(edited
            ? {
                edited: true,
                editedText: proposal.userEditedText,
                ...(proposal.userEditedTextTruncated
                  ? { editedTextTruncated: true }
                  : {})
              }
            : {})
        },
        review: {
          runId: proposal.runId,
          proposalId: proposal.id,
          reviewable: proposal.status === "pending" && !proposal.staleBase
        }
      });
    }
  }
  return items;
}

function isWaiting(item: WriteApprovalItem): boolean {
  return item.state === "waiting";
}

function response(
  items: readonly WriteApprovalItem[]
): AgentWriteApprovalResponse {
  const listed = items.slice(0, PROPOSAL_SETTLEMENT_MAX_ITEMS);
  return {
    items: listed.map((item) => ({
      ...item.result,
      status: item.state === "waiting" ? "failed" : item.state
    })),
    ...(items.length > listed.length
      ? { omittedCount: items.length - listed.length }
      : {})
  };
}

/**
 * Keeps a paused user-review run on hold until every proposal of the step is
 * settled, then reports the outcomes and lets the run continue.
 */
export function createWriteApprovalWatcher(
  options: {
    messages: Ref<ChatMessage[]>;
    userInput: AgentUserInputController;
  },
  /** How long to wait for proposals that have not reached the window. */
  missingGraceMs = 5_000
) {
  const scope = effectScope(true);
  const items = shallowRef<WriteApprovalItem[] | null>(null);
  const submitFailed = shallowRef(false);
  let seen = new Map<string, WriteApprovalItem>();
  let seenRequestId = "";
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  // A failed submission restores the request before `submit` returns.
  let submitting = false;

  const request = computed((): WriteApprovalRequest | null => {
    const pending = options.userInput.request.value;
    return pending?.source === "write_approval" && pending.writeApproval
      ? (pending as WriteApprovalRequest)
      : null;
  });

  function clearGrace(): void {
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = undefined;
  }

  async function submit(list: readonly WriteApprovalItem[]): Promise<void> {
    clearGrace();
    submitting = true;
    try {
      const ok = await options.userInput.submit(
        [{ id: WRITE_APPROVAL_QUESTION_ID, text: "settled" }],
        response(list)
      );
      submitFailed.value = !ok;
    } finally {
      submitting = false;
    }
  }

  scope.run(() => {
    const current = computed(() => {
      const pending = request.value;
      if (!pending) return null;
      return [
        ...proposalItems(options.messages.value, pending),
        ...[...sources].flatMap((source) => source(pending))
      ];
    });
    watch(
      current,
      (list) => {
        const pending = request.value;
        if (!pending || !list) {
          clearGrace();
          items.value = null;
          return;
        }
        if (seenRequestId !== pending.requestId) {
          seen = new Map();
          seenRequestId = pending.requestId;
          submitFailed.value = false;
        }
        const present = new Set(list.map(({ key }) => key));
        for (const item of list) seen.set(item.key, item);
        const merged = [...seen.values()].map((item) =>
          present.has(item.key) || !isWaiting(item)
            ? item
            : { ...item, state: "rejected" as const }
        );
        items.value = merged;
        if (submitFailed.value || submitting) return;
        if (!merged.length) {
          graceTimer ??= setTimeout(() => {
            graceTimer = undefined;
            if (request.value === pending && !items.value?.length)
              void submit([]);
          }, missingGraceMs);
          return;
        }
        clearGrace();
        if (!merged.some(isWaiting)) void submit(merged);
      },
      { immediate: true }
    );
  });

  return {
    /** The paused step's proposals; null while no write approval is pending. */
    items,
    submitFailed,
    /** Retries reporting after a failed submission. */
    retry(): void {
      if (items.value && !items.value.some(isWaiting)) void submit(items.value);
    },
    stop(): void {
      clearGrace();
      scope.stop();
    }
  };
}
