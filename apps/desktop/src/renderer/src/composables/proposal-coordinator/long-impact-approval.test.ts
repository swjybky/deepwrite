import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "../useAgentConversation";
import { holdLongProposalForManualReview } from "./long-impact-approval";

function holdInput(automatic: boolean, hadExpectedImpact: boolean) {
  const updateEditProposal = vi.fn();
  const removeQueued = vi.fn();
  const notify = vi.fn();
  const held = holdLongProposalForManualReview({
    automatic,
    hadExpectedImpact,
    conversation: {
      updateEditProposal
    } as unknown as AgentConversationController,
    runId: "run_1",
    proposalId: "proposal_1",
    patch: {},
    statusMessage: "review impact",
    notificationMessage: "review impact",
    removeQueued,
    notify
  });
  return { held, updateEditProposal, removeQueued, notify };
}

describe("holdLongProposalForManualReview", () => {
  it("saves automatic proposals directly, deletions included", () => {
    const result = holdInput(true, false);
    expect(result.held).toBe(false);
    expect(result.updateEditProposal).not.toHaveBeenCalled();
    expect(result.removeQueued).not.toHaveBeenCalled();
  });

  it("shows a manual proposal's impact once before confirmation", () => {
    const first = holdInput(false, false);
    expect(first.held).toBe(true);
    expect(first.removeQueued).toHaveBeenCalledOnce();
    expect(first.updateEditProposal).toHaveBeenCalledWith(
      "run_1",
      "proposal_1",
      expect.objectContaining({
        status: "pending",
        approvalMode: "request-approval"
      })
    );

    const confirmed = holdInput(false, true);
    expect(confirmed.held).toBe(false);
  });
});
