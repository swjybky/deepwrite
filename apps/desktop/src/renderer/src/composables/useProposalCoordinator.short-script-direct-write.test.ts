import { createShortWorkspaceContentRevision as revision } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  BOOK_ID,
  DOCUMENT_ID,
  INITIAL_CONTENT,
  RUN_ID,
  createFixture,
  mutationEvent,
  renameEvent,
  savedDocument
} from "./useProposalCoordinator.short-script.test-support";

describe("short/script agent direct document writes", () => {
  it.each([
    ["short", "短篇"],
    ["script", "剧本"]
  ] as const)(
    "%s serializes consecutive full-text writes even when a sibling's base is stale",
    async (bookType, _label) => {
      const fixture = createFixture(bookType);
      const firstText = "上一个子智能体写入的完整正文";
      const secondText = "下一个子智能体接着写入的最终完整正文";

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent("tool-first", firstText, revision(INITIAL_CONTENT), 1)
      );
      await vi.waitFor(() =>
        expect(fixture.saveDocument).toHaveBeenCalledTimes(1)
      );

      // The second subagent edited its own snapshot of the original text.
      fixture.coordinator.stageAgentEditProposal(
        mutationEvent("tool-second", secondText, "another-stale-revision", 2)
      );

      const staged = fixture.conversation
        .listEditProposals(RUN_ID)
        .sort(
          (left, right) => (left.generation ?? 1) - (right.generation ?? 1)
        );
      expect(staged).toHaveLength(2);
      expect(staged[0]).toMatchObject({
        generation: 1,
        proposedText: firstText,
        status: "accepting"
      });
      expect(staged[1]).toMatchObject({
        generation: 2,
        predecessorProposalId: staged[0]!.id,
        proposedText: secondText,
        status: "pending"
      });
      expect(staged[1]).not.toHaveProperty("staleBase");
      expect(fixture.saveDocument).toHaveBeenCalledTimes(1);
      expect(fixture.markToolConflict).not.toHaveBeenCalled();

      const firstInput = fixture.saveDocument.mock.calls[0]![0];
      fixture.firstSave.resolve(savedDocument(firstInput, 8));
      await fixture.coordinator.drain();

      expect(fixture.saveDocument).toHaveBeenCalledTimes(2);
      // Each write expects exactly the text this window last saw on disk.
      expect(fixture.saveDocument.mock.calls.map(([input]) => input)).toEqual([
        {
          bookId: BOOK_ID,
          documentId: DOCUMENT_ID,
          content: firstText,
          baseRevision: revision(INITIAL_CONTENT)
        },
        {
          bookId: BOOK_ID,
          documentId: DOCUMENT_ID,
          content: secondText,
          baseRevision: revision(firstText)
        }
      ]);
      for (const [input] of fixture.saveDocument.mock.calls) {
        expect(input).not.toHaveProperty("force");
        expect(input).not.toHaveProperty("baseProjectRevision");
      }
      expect(fixture.documents.value[0]!.content).toBe(secondText);
      expect(
        fixture.conversation
          .listEditProposals(RUN_ID)
          .map((proposal) => proposal.status)
      ).toEqual(["accepted", "accepted"]);
      expect(fixture.markToolConflict).not.toHaveBeenCalled();
      expect(fixture.notifications.warning).not.toHaveBeenCalled();

      await fixture.coordinator.dispose();
    }
  );

  it.each([
    ["short", "短篇"],
    ["script", "剧本"]
  ] as const)(
    "%s preserves an earlier rename when the next subagent writes body text",
    async (bookType, _label) => {
      const fixture = createFixture(bookType);
      const renamedTitle =
        bookType === "short" ? "改名后的章节" : "改名后的剧集";
      const nextText = "下一个子智能体写入的正文";

      fixture.coordinator.stageAgentEditProposal(
        renameEvent("tool-rename", renamedTitle, 1)
      );
      await vi.waitFor(() =>
        expect(fixture.saveDocument).toHaveBeenCalledTimes(1)
      );

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "tool-body-after-rename",
          nextText,
          revision(INITIAL_CONTENT),
          2
        )
      );
      expect(fixture.saveDocument).toHaveBeenCalledTimes(1);

      const renameInput = fixture.saveDocument.mock.calls[0]![0];
      expect(renameInput).toEqual({
        bookId: BOOK_ID,
        documentId: DOCUMENT_ID,
        title: renamedTitle,
        content: "",
        preserveCurrentContent: true,
        force: true
      });
      fixture.firstSave.resolve(savedDocument(renameInput, 8, renamedTitle));
      await fixture.coordinator.drain();

      expect(fixture.saveDocument).toHaveBeenCalledTimes(2);
      expect(fixture.saveDocument.mock.calls[1]![0]).toEqual({
        bookId: BOOK_ID,
        documentId: DOCUMENT_ID,
        content: nextText,
        baseRevision: revision(INITIAL_CONTENT)
      });
      expect(fixture.saveDocument.mock.calls[1]![0]).not.toHaveProperty(
        "title"
      );
      expect(fixture.documents.value[0]).toMatchObject({
        title: renamedTitle,
        content: nextText
      });
      expect(fixture.markToolConflict).not.toHaveBeenCalled();

      await fixture.coordinator.dispose();
    }
  );
});
