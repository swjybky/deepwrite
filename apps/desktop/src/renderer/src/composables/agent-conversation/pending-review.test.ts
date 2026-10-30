import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { ChatMessage } from "../../types/conversation";
import {
  ACCEPTING_STALL_MS,
  countPendingEditReviews,
  createAcceptingWatchdog
} from "./pending-review";

function messageWith(...statuses: string[]): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    editProposals: statuses.map((status, index) => ({
      id: `p${index}`,
      runId: "r1",
      status
    }))
  } as unknown as ChatMessage;
}

describe("countPendingEditReviews", () => {
  it("counts pending and accepting proposals only", () => {
    const messages = [
      messageWith("pending", "accepting", "accepted", "error", "rejected")
    ];
    expect(countPendingEditReviews(messages)).toBe(2);
    expect(countPendingEditReviews([])).toBe(0);
  });
});

describe("createAcceptingWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const messages = ref<ChatMessage[]>([messageWith("accepting")]);
    const updateEditProposal = vi.fn(
      (_run: string, id: string, patch: { status?: string }) => {
        const proposal = messages.value[0]!.editProposals!.find(
          (candidate) => candidate.id === id
        )!;
        Object.assign(proposal, patch);
        return undefined;
      }
    );
    const stop = createAcceptingWatchdog(
      { messages, updateEditProposal } as never,
      ACCEPTING_STALL_MS
    );
    return { messages, updateEditProposal, stop };
  }

  it("turns a stalled accepting proposal into a retryable error", () => {
    const { messages, updateEditProposal } = setup();
    vi.advanceTimersByTime(ACCEPTING_STALL_MS + 1);
    expect(updateEditProposal).toHaveBeenCalledWith(
      "r1",
      "p0",
      expect.objectContaining({ status: "error" })
    );
    expect(countPendingEditReviews(messages.value)).toBe(0);
  });

  it("leaves proposals that settle in time alone", async () => {
    const { messages, updateEditProposal } = setup();
    vi.advanceTimersByTime(ACCEPTING_STALL_MS - 1000);
    messages.value[0]!.editProposals![0]!.status = "accepted";
    await nextTick();
    vi.advanceTimersByTime(5000);
    expect(updateEditProposal).not.toHaveBeenCalled();
  });

  it("stops timers on dispose", () => {
    const { updateEditProposal, stop } = setup();
    stop();
    vi.advanceTimersByTime(ACCEPTING_STALL_MS * 2);
    expect(updateEditProposal).not.toHaveBeenCalled();
  });
});
