import { describe, expect, it } from "vitest";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts/renderer";
import {
  createFixture,
  INITIAL_CONTENT,
  RUN_ID,
  SESSION_ID,
  mutationEvent
} from "./useProposalCoordinator.short-script.test-support";

describe("proposal persistence version origin", () => {
  it.each(["auto-approve", "request-approval"] as const)(
    "records %s content with the conversation run",
    async (approvalMode) => {
      const fixture = createFixture("short", {
        approvalMode,
        holdFirstSave: false
      });
      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "version-write",
          "改写后的正文",
          createShortWorkspaceContentRevision(INITIAL_CONTENT),
          1
        )
      );
      if (approvalMode === "request-approval") {
        const proposal = fixture.conversation.listEditProposals(RUN_ID)[0]!;
        await fixture.coordinator.reviewAgentEdit({
          runId: RUN_ID,
          proposalId: proposal.id,
          decision: "accept"
        });
      }
      await fixture.coordinator.drain();
      expect(fixture.saveDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          versionOrigin: {
            sessionId: SESSION_ID,
            runId: RUN_ID,
            summary: "第 1 次写入正文"
          }
        })
      );
      await fixture.coordinator.dispose();
    }
  );
});
