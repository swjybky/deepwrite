import { createShortWorkspaceContentRevision as revision } from "@deepwrite/contracts";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import {
  CHARACTER_DOCUMENT_ID,
  CHARACTER_TITLE,
  INITIAL_CHARACTER,
  REVISED_CHARACTER,
  createCharacterEvent,
  createCharacterFixture,
  editCharacterEvent
} from "./useProposalCoordinator.character.test-support";
import { RUN_ID } from "./useProposalCoordinator.short-script.test-support";

type Fixture = ReturnType<typeof createCharacterFixture>;
const fixtures: Fixture[] = [];

async function createdCharacter(bookType: "short" | "script" = "short") {
  const fixture = createCharacterFixture(bookType);
  fixtures.push(fixture);
  await fixture.coordinator.stageAgentEditProposal(createCharacterEvent());
  await fixture.coordinator.drain();
  expect(fixture.conversation.listEditProposals(RUN_ID)[0]?.status).toBe(
    "accepted"
  );
  return fixture;
}

function contentProposals(fixture: Fixture) {
  return fixture.conversation
    .listEditProposals(RUN_ID)
    .filter((proposal) => proposal.documentId === CHARACTER_DOCUMENT_ID);
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.coordinator.dispose();
    fixture.loader.dispose();
  }
});

describe("same-conversation character revision safety", () => {
  it.each(["short", "script"] as const)(
    "%s loads a new card and accepts consecutive edits with correct diffs and undo text",
    async (bookType) => {
      const fixture = await createdCharacter(bookType);
      expect(fixture.documents.value[0]).toMatchObject({
        content: INITIAL_CHARACTER,
        catalogContentLoaded: true
      });
      expect(fixture.readDocument).toHaveBeenCalledOnce();

      await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
      await fixture.coordinator.drain();
      const nextText = `${REVISED_CHARACTER}\n再次补充人物关系。`;
      await fixture.coordinator.stageAgentEditProposal(
        editCharacterEvent(nextText, REVISED_CHARACTER, 3)
      );
      await fixture.coordinator.drain();

      const proposals = contentProposals(fixture);
      expect(proposals).toHaveLength(2);
      expect(proposals[0]).toMatchObject({
        status: "accepted",
        baseRevision: revision(INITIAL_CHARACTER),
        discardSnapshot: { beforeText: INITIAL_CHARACTER }
      });
      expect(proposals[0]?.hunks).toEqual(
        buildAgentTextDiff(INITIAL_CHARACTER, REVISED_CHARACTER).hunks
      );
      expect(proposals[1]).toMatchObject({
        status: "accepted",
        generation: 2,
        baseRevision: revision(REVISED_CHARACTER),
        discardSnapshot: { beforeText: REVISED_CHARACTER }
      });
      for (const proposal of proposals)
        expect(proposal).not.toHaveProperty("staleBase");
      expect(fixture.diskContent()).toBe(nextText);
      expect(
        fixture.saveDocument.mock.calls
          .slice(1)
          .map(([input]) => input.baseRevision)
      ).toEqual([revision(INITIAL_CHARACTER), revision(REVISED_CHARACTER)]);
      expect(fixture.notifications.warning).not.toHaveBeenCalled();
    }
  );

  it("hydrates an unopened card before staging its version check and diff", async () => {
    const fixture = await createdCharacter();
    fixture.loader.invalidate(CHARACTER_DOCUMENT_ID, { discardContent: true });
    expect(fixture.documents.value[0]?.catalogContentLoaded).toBe(false);

    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    await fixture.coordinator.drain();

    const [proposal] = contentProposals(fixture);
    expect(proposal).toMatchObject({
      status: "accepted",
      discardSnapshot: { beforeText: INITIAL_CHARACTER }
    });
    expect(proposal).not.toHaveProperty("staleBase");
    expect(proposal?.hunks).toEqual(
      buildAgentTextDiff(INITIAL_CHARACTER, REVISED_CHARACTER).hunks
    );
    expect(fixture.diskContent()).toBe(REVISED_CHARACTER);
  });

  it("retains the initial body when the next edit arrives before creation finishes saving", async () => {
    const fixture = createCharacterFixture();
    fixtures.push(fixture);
    const save = fixture.saveDocument.getMockImplementation()!;
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.saveDocument.mockImplementationOnce(async (input) => {
      await pendingSave;
      return save(input);
    });
    await fixture.coordinator.stageAgentEditProposal(createCharacterEvent());
    await vi.waitFor(() => expect(fixture.saveDocument).toHaveBeenCalledOnce());
    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    const staged = contentProposals(fixture)[0];
    release();
    await fixture.coordinator.drain();

    expect(staged).toMatchObject({
      discardSnapshot: { beforeText: INITIAL_CHARACTER }
    });
    expect(staged?.hunks).toEqual(
      buildAgentTextDiff(INITIAL_CHARACTER, REVISED_CHARACTER).hunks
    );
    expect(contentProposals(fixture)[0]).toMatchObject({ status: "accepted" });
    expect(contentProposals(fixture)[0]).not.toHaveProperty("staleBase");
    expect(fixture.diskContent()).toBe(REVISED_CHARACTER);
    expect(fixture.notifications.warning).not.toHaveBeenCalled();
  });

  it.each(["用户亲自修改。", ""])(
    "holds a real saved edit after an earlier agent edit (user text: %j)",
    async (userText) => {
      const fixture = await createdCharacter();
      await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
      await fixture.coordinator.drain();
      fixture.saveExternalText(userText);

      const nextText = `${REVISED_CHARACTER}\n再次补充人物设定。`;
      await fixture.coordinator.stageAgentEditProposal(
        editCharacterEvent(nextText, REVISED_CHARACTER, 3)
      );
      await fixture.coordinator.drain();

      const proposal = contentProposals(fixture)[1];
      expect(proposal).toMatchObject({
        status: "pending",
        approvalMode: "request-approval",
        staleBase: { currentRevision: revision(userText) },
        discardSnapshot: { beforeText: userText }
      });
      expect(proposal?.hunks).toEqual(
        buildAgentTextDiff(userText, nextText).hunks
      );
      expect(fixture.saveDocument).toHaveBeenCalledTimes(2);
      expect(fixture.diskContent()).toBe(userText);
    }
  );

  it("uses the saved version on the next turn of the same conversation", async () => {
    const fixture = await createdCharacter();
    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    await fixture.coordinator.drain();
    vi.spyOn(fixture.conversation, "acceptsRunEvent").mockReturnValue(true);
    const runId = "run-next-character-turn";
    const nextText = `${REVISED_CHARACTER}\n下一轮对话补充人物关系。`;
    const event = editCharacterEvent(nextText, REVISED_CHARACTER, 3);
    await fixture.coordinator.stageAgentEditProposal({
      ...event,
      payload: { ...event.payload, runId }
    });
    await fixture.coordinator.drain();

    const [proposal] = fixture.conversation.listEditProposals(runId);
    expect(proposal).toMatchObject({
      status: "accepted",
      baseRevision: revision(REVISED_CHARACTER),
      discardSnapshot: { beforeText: REVISED_CHARACTER }
    });
    expect(proposal).not.toHaveProperty("staleBase");
    expect(fixture.diskContent()).toBe(nextText);
    expect(fixture.notifications.warning).not.toHaveBeenCalled();
  });

  it("checks an unsaved user draft created while the body is loading", async () => {
    const fixture = await createdCharacter();
    fixture.loader.invalidate(CHARACTER_DOCUMENT_ID, { discardContent: true });
    const read = fixture.readDocument.getMockImplementation()!;
    let release!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.readDocument.mockImplementationOnce(async (input) => {
      await pendingRead;
      return read(input);
    });
    const staging =
      fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    await vi.waitFor(() =>
      expect(fixture.readDocument).toHaveBeenCalledTimes(2)
    );
    const userText = "用户尚未保存的人物设定。";
    fixture.drafts.value = {
      [CHARACTER_DOCUMENT_ID]: {
        title: CHARACTER_TITLE,
        content: userText,
        dirty: true
      }
    };
    release();
    await staging;
    await fixture.coordinator.drain();

    expect(contentProposals(fixture)[0]).toMatchObject({
      status: "pending",
      staleBase: { currentRevision: revision(userText) },
      discardSnapshot: { beforeText: userText }
    });
    expect(fixture.saveDocument).toHaveBeenCalledOnce();
    expect(fixture.drafts.value[CHARACTER_DOCUMENT_ID]?.content).toBe(userText);
    expect(fixture.diskContent()).toBe(INITIAL_CHARACTER);
  });

  it("reloads an unloaded review target before approving, preserving a newer saved version", async () => {
    const fixture = await createdCharacter();
    vi.spyOn(fixture.conversation, "approvalModeForRun").mockReturnValue(
      "request-approval"
    );
    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    const proposal = contentProposals(fixture)[0]!;
    const userText = "审阅期间用户保存的新人物设定。";
    fixture.saveExternalText(userText);

    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: proposal.id,
      decision: "accept"
    });
    await fixture.coordinator.drain();

    expect(contentProposals(fixture)[0]).toMatchObject({
      status: "pending",
      staleBase: { currentRevision: revision(userText) }
    });
    expect(fixture.saveDocument).toHaveBeenCalledOnce();
    expect(fixture.diskContent()).toBe(userText);
  });

  it("keeps Core's disk-version guard when another writer changes the file after staging", async () => {
    const fixture = await createdCharacter();
    vi.spyOn(fixture.conversation, "approvalModeForRun").mockReturnValue(
      "request-approval"
    );
    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    const proposal = contentProposals(fixture)[0]!;
    const userText = "另一个窗口保存的人物设定。";
    fixture.saveExternalText(userText, false);

    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: proposal.id,
      decision: "accept"
    });
    await fixture.coordinator.drain();

    expect(contentProposals(fixture)[0]).toMatchObject({
      status: "pending",
      staleBase: { currentRevision: revision(userText) }
    });
    expect(fixture.saveDocument.mock.calls[1]?.[0]).toMatchObject({
      baseRevision: revision(INITIAL_CHARACTER)
    });
    expect(fixture.saveDocument.mock.calls[1]?.[0]).not.toHaveProperty("force");
    expect(fixture.diskContent()).toBe(userText);
  });

  it("does not stage or save a proposal when the unloaded body cannot be read", async () => {
    const fixture = await createdCharacter();
    fixture.loader.invalidate(CHARACTER_DOCUMENT_ID, { discardContent: true });
    fixture.readDocument.mockRejectedValueOnce(
      new Error("Character read failed")
    );

    await fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    await fixture.coordinator.drain();

    expect(contentProposals(fixture)).toEqual([]);
    expect(fixture.markToolConflict).toHaveBeenCalledOnce();
    expect(fixture.notifications.error).toHaveBeenCalledOnce();
    expect(fixture.saveDocument).toHaveBeenCalledOnce();
    expect(fixture.diskContent()).toBe(INITIAL_CHARACTER);
  });

  it("drains an in-flight read on disposal without publishing another proposal or notice", async () => {
    const fixture = await createdCharacter();
    fixture.loader.invalidate(CHARACTER_DOCUMENT_ID, { discardContent: true });
    let release!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.readDocument.mockImplementationOnce(async () => {
      await pendingRead;
      throw new Error("Read cancelled");
    });
    const staging =
      fixture.coordinator.stageAgentEditProposal(editCharacterEvent());
    await vi.waitFor(() =>
      expect(fixture.readDocument).toHaveBeenCalledTimes(2)
    );
    const disposal = fixture.coordinator.dispose();
    release();
    await Promise.all([staging, disposal]);

    expect(contentProposals(fixture)).toEqual([]);
    expect(fixture.notifications.error).not.toHaveBeenCalled();
    expect(fixture.markToolConflict).not.toHaveBeenCalled();
    expect(fixture.saveDocument).toHaveBeenCalledOnce();
  });
});
