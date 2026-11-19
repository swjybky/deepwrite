import {
  describe,
  expect,
  it,
  harness,
  continuityWriteEvent,
  proposalBase,
  systemEvent,
  createEnvelope,
  envelopeContext,
  textFilesLedgerEvent,
  mutationEvent,
  vi
} from "./useLongWorkspaceProposals.test-support";

function combinedEvent() {
  const fileEvent = continuityWriteEvent();
  if (fileEvent.type !== "long.continuity_file_proposal")
    throw new Error("Expected file event");
  return systemEvent(
    createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...proposalBase,
        toolCallId: "tool_combined",
        input: {
          bookId: proposalBase.bookId,
          mode: "text_files_batch",
          chapterCardIds: ["chapter_one"],
          checkpointChapterCardId: "chapter_one",
          commitMessage: "合并归档",
          foreshadowingBeatDecisions: {},
          preparation: {
            commitId: "commit_combined",
            batch: fileEvent.payload.batch,
            bodyVersions: [
              { fileId: "file_body", expectedSha256: "a".repeat(64) }
            ]
          }
        },
        files: fileEvent.payload.files
      },
      { id: "event_combined", context: envelopeContext }
    )
  );
}

describe("combined continuity approvals", () => {
  it("previews one card, waits for acceptance, and commits without a separate file write", async () => {
    const origin = {
      sessionId: "session_origin",
      runId: "run_origin",
      summary: "版本来源"
    };
    const h = harness(true, "request-approval", () => origin);
    const event = combinedEvent();
    await h.controller.handleEvent(event);
    expect(h.controller.itemsForBook(proposalBase.bookId)).toHaveLength(1);
    expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
      "ready"
    );
    expect(h.commitChapter).not.toHaveBeenCalled();
    await h.controller.approve(proposalBase.bookId, event.id);
    expect(h.commitChapter).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        preparation: expect.objectContaining({ versionOrigin: origin })
      })
    );
    expect(h.applyOperations).not.toHaveBeenCalled();
    expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
      "accepted"
    );
    expect(await h.controller.handleEvent(event)).toBe(false);
  });
  it("refreshes a waiting combined card after its predecessor is rejected", async () => {
    const h = harness();
    const prior = mutationEvent({ toolCallId: "prior" });
    await h.controller.handleEvent(prior);
    const event = combinedEvent();
    await h.controller.handleEvent(event);
    expect(
      h.controller
        .itemsForBook(proposalBase.bookId)
        .find((item) => item.event.id === event.id)!.status
    ).toBe("waiting");
    h.controller.reject(proposalBase.bookId, prior.id);
    await vi.waitFor(() =>
      expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
        "ready"
      )
    );
    expect(h.commitChapter).not.toHaveBeenCalled();
  });
  it("ignores an acceptance queued behind an already accepted commit", async () => {
    const h = harness();
    const event = combinedEvent();
    await h.controller.handleEvent(event);
    await Promise.all([
      h.controller.approve(proposalBase.bookId, event.id),
      h.controller.approve(proposalBase.bookId, event.id)
    ]);
    expect(h.commitChapter).toHaveBeenCalledOnce();
  });
  it("rejects without saving", async () => {
    const h = harness();
    const event = combinedEvent();
    await h.controller.handleEvent(event);
    expect(h.controller.reject(proposalBase.bookId, event.id)).toBe(true);
    expect(h.commitChapter).not.toHaveBeenCalled();
    expect(h.controller.itemsForBook(proposalBase.bookId)).toHaveLength(0);
  });
  it("automatically saves only after preview and pre-save checks", async () => {
    const h = harness(true, "auto-approve");
    await h.controller.handleEvent(combinedEvent());
    expect(h.previewOperations).toHaveBeenCalledOnce();
    expect(h.prepareAutoApprove).toHaveBeenCalledOnce();
    expect(h.commitChapter).toHaveBeenCalledOnce();
    expect(h.applyOperations).not.toHaveBeenCalled();
  });
  it.each(["request-approval", "auto-approve"] as const)(
    "reports a failed %s save and retries the same proposal",
    async (approvalMode) => {
      const h = harness(true, approvalMode);
      const event = combinedEvent();
      h.commitChapter.mockRejectedValueOnce(new Error("事务暂时失败"));
      await h.controller.handleEvent(event);
      if (approvalMode === "request-approval")
        await h.controller.approve(proposalBase.bookId, event.id);
      expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
        "error"
      );
      expect(h.notifications.error).toHaveBeenCalledOnce();
      expect(h.notifications.success).not.toHaveBeenCalled();
      expect(h.onApplied).not.toHaveBeenCalled();
      await h.controller.approve(proposalBase.bookId, event.id);
      expect(h.commitChapter).toHaveBeenCalledTimes(2);
      expect(h.commitChapter.mock.calls[1]).toEqual(
        h.commitChapter.mock.calls[0]
      );
      expect(h.applyOperations).not.toHaveBeenCalled();
      expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
        "accepted"
      );
      expect(h.onApplied).toHaveBeenCalledOnce();
    }
  );
  it("does not save after a failed preview and supports manual preview retry", async () => {
    const h = harness();
    h.previewOperations.mockRejectedValueOnce(new Error("预览失败"));
    const event = combinedEvent();
    await h.controller.handleEvent(event);
    expect(h.commitChapter).not.toHaveBeenCalled();
    await h.controller.retryPreview(proposalBase.bookId, event.id);
    expect(h.controller.itemsForBook(proposalBase.bookId)[0]!.status).toBe(
      "ready"
    );
    expect(h.commitChapter).not.toHaveBeenCalled();
  });
  it("retains the old automatic ledger-only flow", async () => {
    const h = harness();
    await h.controller.handleEvent(textFilesLedgerEvent());
    expect(h.commitChapter).toHaveBeenCalledOnce();
    expect(h.previewOperations).not.toHaveBeenCalled();
  });
  it("rejects mismatched displayed files and missing combined metadata", () => {
    const event = combinedEvent();
    if (event.type !== "long.ledger_commit_proposal")
      throw new Error("Expected ledger event");
    event.payload.files![0]!.afterText = "与批次不同";
    expect(() => systemEvent(event)).toThrow();
    delete event.payload.files;
    expect(() => systemEvent(event)).toThrow();
  });
});
