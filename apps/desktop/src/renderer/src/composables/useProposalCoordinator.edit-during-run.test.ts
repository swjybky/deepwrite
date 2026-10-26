import { createShortWorkspaceContentRevision as revision } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  BOOK_ID,
  DOCUMENT_ID,
  INITIAL_CONTENT,
  RUN_ID,
  createFixture,
  mutationEvent
} from "./useProposalCoordinator.short-script.test-support";

const AGENT_TEXT = "智能体校对后的第一节";
const USER_TEXT = `${INITIAL_CONTENT}，用户在智能体运行时补写的一句`;

function stagedAfterUserEdit(
  approvalMode: "auto-approve" | "request-approval"
) {
  const fixture = createFixture("short", {
    approvalMode,
    holdFirstSave: false
  });
  // The agent read the original text; the user then edited and autosaved.
  fixture.saveUserText(USER_TEXT);
  fixture.coordinator.stageAgentEditProposal(
    mutationEvent("tool-proofread", AGENT_TEXT, revision(INITIAL_CONTENT), 1)
  );
  const [proposal] = fixture.conversation.listEditProposals(RUN_ID);
  return { fixture, proposal: proposal! };
}

describe("editing a document while the agent runs", () => {
  it("pauses an automatic edit instead of overwriting the user's text", async () => {
    const { fixture, proposal } = stagedAfterUserEdit("auto-approve");
    await fixture.coordinator.drain();

    expect(proposal).toMatchObject({
      status: "pending",
      approvalMode: "request-approval",
      staleBase: { currentRevision: revision(USER_TEXT) }
    });
    expect(fixture.saveDocument).not.toHaveBeenCalled();
    expect(fixture.documents.value[0]!.content).toBe(USER_TEXT);
    expect(fixture.notifications.warning).toHaveBeenCalledOnce();
    await fixture.coordinator.dispose();
  });

  it("keeps the user's version when they choose so", async () => {
    const { fixture, proposal } = stagedAfterUserEdit("request-approval");
    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: proposal.id,
      decision: "reject"
    });

    expect(
      fixture.conversation.getEditProposal(RUN_ID, proposal.id)
    ).toMatchObject({
      status: "rejected",
      staleBase: { resolution: "kept-user" }
    });
    expect(fixture.saveDocument).not.toHaveBeenCalled();
    expect(fixture.documents.value[0]!.content).toBe(USER_TEXT);
    await fixture.coordinator.dispose();
  });

  it("overwrites exactly the version the user saw, and can undo to it", async () => {
    const { fixture, proposal } = stagedAfterUserEdit("request-approval");
    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: proposal.id,
      decision: "accept"
    });
    await fixture.coordinator.drain();

    expect(fixture.saveDocument).toHaveBeenCalledOnce();
    expect(fixture.saveDocument.mock.calls[0]![0]).toEqual({
      bookId: BOOK_ID,
      documentId: DOCUMENT_ID,
      content: AGENT_TEXT,
      baseRevision: revision(USER_TEXT)
    });
    expect(
      fixture.conversation.getEditProposal(RUN_ID, proposal.id)
    ).toMatchObject({
      status: "accepted",
      staleBase: { resolution: "overwrote" },
      discardSnapshot: { beforeText: USER_TEXT }
    });
    expect(fixture.documents.value[0]!.content).toBe(AGENT_TEXT);
    await fixture.coordinator.dispose();
  });

  it("asks again when the user kept typing after seeing the notice", async () => {
    const { fixture, proposal } = stagedAfterUserEdit("request-approval");
    const typedMore = `${USER_TEXT}，又补了一句`;
    fixture.typeUserDraft(typedMore);
    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: proposal.id,
      decision: "accept"
    });
    await fixture.coordinator.drain();

    expect(fixture.saveDocument).not.toHaveBeenCalled();
    expect(
      fixture.conversation.getEditProposal(RUN_ID, proposal.id)
    ).toMatchObject({
      status: "pending",
      staleBase: { currentRevision: revision(typedMore) }
    });
    expect(fixture.drafts.value[DOCUMENT_ID]?.content).toBe(typedMore);
    await fixture.coordinator.dispose();
  });

  it("treats an unsaved draft in the editor as the user's version", async () => {
    const fixture = createFixture("script", { holdFirstSave: false });
    fixture.typeUserDraft(USER_TEXT);
    fixture.coordinator.stageAgentEditProposal(
      mutationEvent("tool-proofread", AGENT_TEXT, revision(INITIAL_CONTENT), 1)
    );
    await fixture.coordinator.drain();

    const [proposal] = fixture.conversation.listEditProposals(RUN_ID);
    expect(proposal).toMatchObject({
      status: "pending",
      staleBase: { currentRevision: revision(USER_TEXT) }
    });
    expect(fixture.saveDocument).not.toHaveBeenCalled();
    expect(fixture.drafts.value[DOCUMENT_ID]?.content).toBe(USER_TEXT);
    await fixture.coordinator.dispose();
  });

  it("holds the edit when Core finds the text changed during the write", async () => {
    const fixture = createFixture("short", { holdFirstSave: false });
    const diskText = `${INITIAL_CONTENT}，另一个窗口写入`;
    fixture.saveDocument.mockImplementationOnce(() =>
      Promise.reject({
        code: "catalog.conflict",
        message: "conflict",
        details: {
          expectedRevision: revision(INITIAL_CONTENT),
          actualRevision: revision(diskText)
        }
      })
    );
    fixture.coordinator.stageAgentEditProposal(
      mutationEvent("tool-proofread", AGENT_TEXT, revision(INITIAL_CONTENT), 1)
    );
    await fixture.coordinator.drain();

    const [proposal] = fixture.conversation.listEditProposals(RUN_ID);
    expect(proposal).toMatchObject({
      status: "pending",
      approvalMode: "request-approval",
      staleBase: { currentRevision: revision(diskText) }
    });
    expect(fixture.documents.value[0]!.content).toBe(INITIAL_CONTENT);
    await fixture.coordinator.dispose();
  });
});
