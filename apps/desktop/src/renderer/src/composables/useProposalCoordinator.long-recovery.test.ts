import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import { parseStoredEditProposal } from "./agent-conversation/parse-proposal";
import { createLongProposalRecoveryFixture } from "./useProposalCoordinator.long-recovery.test-support";

const firstId = "proposal-long-delete";
const laterId = "proposal-long-delete:second";
const runId = "run-long-delete";
const chain: Partial<AgentEditProposal>[] = [
  {},
  { id: laterId, generation: 2, predecessorProposalId: firstId }
];

afterEach(() => vi.unstubAllGlobals());

describe("long proposal dependency recovery", () => {
  it("retains a follower after a save failure and resumes it after the predecessor is retried", async () => {
    const fixture = createLongProposalRecoveryFixture(chain);
    try {
      fixture.applyOperations.mockRejectedValueOnce({
        code: "catalog.command_failed",
        message: "Temporary storage failure"
      });
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();

      expect(fixture.proposal().status).toBe("error");
      expect(fixture.proposal(laterId)).toMatchObject({
        status: "pending",
        proposedText: "删除第一卷"
      });
      expect(fixture.proposal(laterId).statusMessage).toContain(
        fixture.proposal().statusMessage!
      );

      // The first click previews fresh impact; the second confirms that impact.
      const request = {
        runId,
        proposalId: firstId,
        decision: "accept" as const
      };
      await fixture.coordinator.reviewLongAgentEdit(request);
      await fixture.coordinator.drain();
      await fixture.coordinator.reviewLongAgentEdit(request);
      await fixture.coordinator.drain();
      expect(fixture.proposal().status).toBe("accepted");
      expect(fixture.proposal(laterId).status).toBe("accepted");
      expect(fixture.applyOperations).toHaveBeenCalledTimes(3);
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("keeps a legacy manual hold reviewable and continues its automatic followers after confirmation", async () => {
    const fixture = createLongProposalRecoveryFixture([
      { approvalMode: "request-approval" },
      chain[1]!
    ]);
    try {
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();
      expect(fixture.applyOperations).not.toHaveBeenCalled();
      expect(fixture.proposal(laterId).statusMessage).toContain("剧情设计变更");

      const request = {
        runId,
        proposalId: firstId,
        decision: "accept" as const
      };
      await fixture.coordinator.reviewLongAgentEdit(request);
      await fixture.coordinator.drain();
      expect(fixture.applyOperations).not.toHaveBeenCalled();
      await fixture.coordinator.reviewLongAgentEdit(request);
      await fixture.coordinator.drain();
      expect(fixture.proposal().status).toBe("accepted");
      expect(fixture.proposal(laterId).status).toBe("accepted");
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("does not block a new conversation in the same book behind an old failed run", async () => {
    const newId = "proposal-new-conversation";
    const fixture = createLongProposalRecoveryFixture([
      { status: "error", statusMessage: "Old save failed" },
      { id: newId, runId: "run-new-conversation" }
    ]);
    try {
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();
      expect(fixture.proposal().status).toBe("error");
      expect(fixture.proposal(newId).status).toBe("accepted");
      expect(fixture.applyOperations).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("recovers an old dependent conflict from persisted long proposal targets", async () => {
    const fixture = createLongProposalRecoveryFixture(chain);
    try {
      // Older clients discarded proposedText when the predecessor merely failed.
      const restored = parseStoredEditProposal({
        ...fixture.proposal(laterId),
        status: "conflict",
        proposedText: undefined
      });
      expect(restored).toMatchObject({ status: "pending" });
      fixture.conversation.updateEditProposal(runId, laterId, restored!);
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();
      expect(fixture.proposal().status).toBe("accepted");
      expect(fixture.proposal(laterId).status).toBe("accepted");
      expect(fixture.applyOperations).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("never writes a follower when its predecessor was rejected", async () => {
    const fixture = createLongProposalRecoveryFixture([
      { status: "rejected" },
      chain[1]!
    ]);
    try {
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();
      expect(fixture.proposal(laterId).status).toBe("conflict");
      expect(fixture.applyOperations).not.toHaveBeenCalled();
    } finally {
      await fixture.coordinator.dispose();
    }
  });
});
