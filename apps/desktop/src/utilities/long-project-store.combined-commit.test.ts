import { vi } from "vitest";
import { writeFile } from "node:fs/promises";
import * as longProjectIo from "./long-project-store/io";
import {
  createLongWorkspaceNavigationSnapshot,
  LongCommitChapterInputSchema
} from "@deepwrite/contracts";
import { buildLongWorkspaceTools } from "@deepwrite/pi-runtime-adapter";
import { DEFAULT_LONG_AGENT_PROFILES } from "@deepwrite/contracts";
import {
  createFixture,
  describe,
  expect,
  FIXED_NOW,
  it,
  join,
  projectTransactionContentSha256,
  readFile
} from "./long-project-store.test-support";

const priorForeshadowing = "已保存的伏笔说明。";
const beatId = "beat_combined_direct";
const placedBeatId = "beat_combined_placement";
const placementId = "placement_combined_letter";

async function fixture(withDecisions = false) {
  const { projectStore, created } = await createFixture("combined");
  const dir = created.projectDirectory;
  const originalChapter = created.book.workspaceIndex.chapters[0]!;
  const chapterId = originalChapter.chapterCardId;
  if (withDecisions) {
    const eventId = "event_combined_letter";
    await projectStore.applyWorkspaceOperations(dir, {
      batch: {
        updatedAt: FIXED_NOW,
        documentWrites: [],
        operations: [
          {
            type: "event.create",
            event: {
              id: eventId,
              title: "旧信",
              summary: "收到一封旧信。",
              timeMode: "sequence",
              timeLabel: "第一天",
              storyOrder: 1,
              location: "门口",
              arcIds: [created.book.workspaceIndex.plot.arcs[0]!.id],
              characterIds: []
            }
          },
          {
            type: "placement.create",
            placement: {
              id: placementId,
              eventId,
              chapterCardId: chapterId,
              orderInChapter: 1,
              mode: "scene",
              disclosure: "hint",
              writingPrompt: "",
              status: "planned",
              commitId: null
            }
          },
          {
            type: "foreshadowing.create",
            thread: {
              id: "foreshadow_combined_letter",
              title: "寄信人",
              coreQuestion: "谁寄了信？",
              truthEventId: null,
              expectedReaderEffect: "产生疑问。",
              status: "planned",
              beats: [
                {
                  id: beatId,
                  type: "plant",
                  order: 1,
                  eventId: null,
                  placementId: null,
                  chapterCardId: chapterId,
                  plannedScope: "",
                  note: "",
                  status: "planned",
                  commitId: null
                },
                {
                  id: placedBeatId,
                  type: "reinforce",
                  order: 2,
                  eventId,
                  placementId,
                  chapterCardId: null,
                  plannedScope: "",
                  note: "",
                  status: "planned",
                  commitId: null
                }
              ]
            }
          }
        ]
      }
    });
    await projectStore.writeDocument(dir, {
      fileId: originalChapter.foreshadowingChanges.id,
      content: priorForeshadowing
    });
  }
  await projectStore.writeDocument(dir, {
    fileId: originalChapter.body.id,
    content: "合成章节正文。"
  });
  const index = (await projectStore.openBook(dir)).book.workspaceIndex;
  const chapter = index.chapters[0]!;
  const tools = buildLongWorkspaceTools({
    workspace: {
      bookId: index.bookId,
      title: "合成书",
      activeAgentId: "long",
      activeRoot: "continuity_ledger",
      activeChapterCardId: chapterId,
      navigation: createLongWorkspaceNavigationSnapshot(index)
    },
    profile: DEFAULT_LONG_AGENT_PROFILES[0]!,
    sessionId: "session_combined",
    runId: "run_combined",
    executor: async (command) => ({
      status: "accepted",
      requestId: command.id,
      payload:
        command.type === "long.getWorkspaceIndex"
          ? {
              bookId: index.bookId,
              workspaceIndex: (await projectStore.openBook(dir)).book
                .workspaceIndex
            }
          : command.type === "long.readDocument"
            ? await (async () => {
                const { file, content, offset, totalCharacters, nextOffset } =
                  await projectStore.readDocument(dir, command.payload);
                return {
                  bookId: index.bookId,
                  file,
                  content,
                  offset,
                  totalCharacters,
                  nextOffset
                };
              })()
            : (() => {
                throw new Error("Unexpected command");
              })()
    })
  });
  if (withDecisions) {
    const read = tools.find((tool) => tool.name === "read")!;
    await read.execute("read-prior-foreshadowing", {
      id: chapterId,
      document: "foreshadowing_changes"
    });
  }
  const tool = tools.find((tool) => tool.name === "propose_continuity_commit")!;
  const params = {
    chapter_card_id: chapterId,
    summary: "合并连续性",
    foreshadowing_touchpoint_decisions: withDecisions
      ? [
          {
            foreshadowing_id: "foreshadow_combined_letter",
            beat_id: beatId,
            status: "committed",
            evidence: "正文出现旧信。"
          },
          {
            foreshadowing_id: "foreshadow_combined_letter",
            beat_id: placedBeatId,
            status: "missed",
            evidence: "正文未给出第二个线索。"
          }
        ]
      : [],
    documents: {
      chapter_end_state: "章末状态。",
      handoff: "接续要点。",
      world_reveals: "本批揭露的设定。"
    }
  };
  const result = await tool.execute("combined-one", params);
  if (result.details.kind !== "long-continuity-commit-proposal")
    throw new Error(JSON.stringify(result));
  const input = LongCommitChapterInputSchema.parse(result.details.input);
  if (input.mode !== "text_files_batch" || !input.preparation)
    throw new Error("Expected combined input");
  return { projectStore, dir, index, chapter, input, result };
}

describe("combined continuity transaction", () => {
  it("keeps the proposal unwritten, then atomically stores files and ledger and retries idempotently", async () => {
    const h = await fixture();
    expect(await readFile(join(h.dir, h.chapter.handoff.path), "utf8")).toBe(
      ""
    );
    expect(
      (await h.projectStore.openBook(h.dir)).book.workspaceIndex.chapters[0]!
        .worldReveals
    ).toBeNull();
    const first = await h.projectStore.commitChapter(h.dir, h.input);
    const second = await h.projectStore.commitChapter(h.dir, h.input);
    expect(second.record).toEqual(first.record);
    expect(first.record.schemaVersion).toBe(5);
    const after = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    expect(after.ledger.commits).toHaveLength(1);
    expect(after.chapters[0]!.commitId).toBe(first.record.id);
    expect(await readFile(join(h.dir, h.chapter.handoff.path), "utf8")).toBe(
      "接续要点。"
    );
    expect(
      await readFile(join(h.dir, after.chapters[0]!.worldReveals!.path), "utf8")
    ).toBe("本批揭露的设定。");
  });

  it("archives direct and placement-linked beats with an already saved foreshadowing document", async () => {
    const h = await fixture(true);
    const preparation = h.input.preparation!;
    const foreshadowing = preparation.batch.documentWrites.find(
      ({ fileId }) => fileId === h.chapter.foreshadowingChanges.id
    )!;
    expect(foreshadowing).toMatchObject({
      mode: "replace",
      expectedSha256: projectTransactionContentSha256(priorForeshadowing)
    });
    const first = await h.projectStore.commitChapter(h.dir, h.input);
    expect(await h.projectStore.commitChapter(h.dir, h.input)).toEqual(first);

    const after = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    const id = preparation.commitId;
    expect(first.record.id).toBe(id);
    expect(after.chapters[0]!.commitId).toBe(id);
    expect(after.ledger.commits).toEqual([
      expect.objectContaining({
        id,
        foreshadowingBeatIds: [beatId, placedBeatId],
        placementIds: [placementId]
      })
    ]);
    expect(after.plot.foreshadowing[0]).toMatchObject({
      status: "open",
      beats: [
        { id: beatId, status: "committed", commitId: id },
        { id: placedBeatId, status: "missed", commitId: id }
      ]
    });
    expect(after.plot.narrativePlacements[0]).toMatchObject({
      id: placementId,
      status: "committed",
      commitId: id
    });
    expect(
      await readFile(join(h.dir, h.chapter.foreshadowingChanges.path), "utf8")
    ).toBe(foreshadowing.content);
  });

  it("keeps an intervening foreshadowing edit and writes none of the batch", async () => {
    const h = await fixture(true);
    const content = "用户修订后的伏笔说明。";
    await h.projectStore.writeDocument(h.dir, {
      fileId: h.chapter.foreshadowingChanges.id,
      content
    });
    await expect(
      h.projectStore.commitChapter(h.dir, h.input)
    ).rejects.toMatchObject({ code: "document_changed" });
    const after = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    expect(after.ledger.commits).toHaveLength(0);
    expect(after.chapters[0]!.worldReveals).toBeNull();
    expect(await readFile(join(h.dir, h.chapter.handoff.path), "utf8")).toBe(
      ""
    );
    expect(
      await readFile(join(h.dir, h.chapter.foreshadowingChanges.path), "utf8")
    ).toBe(content);
  });

  it.each(["body", "handoff"] as const)(
    "rejects a stale %s without writing any other file or ledger",
    async (target) => {
      const h = await fixture();
      await h.projectStore.writeDocument(h.dir, {
        fileId: h.chapter[target].id,
        content: "用户已改动。"
      });
      await expect(
        h.projectStore.commitChapter(h.dir, h.input)
      ).rejects.toThrow();
      const after = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
      expect(after.ledger.commits).toHaveLength(0);
      expect(after.chapters[0]!.worldReveals).toBeNull();
      expect(
        await readFile(join(h.dir, h.chapter.characterState.path), "utf8")
      ).toBe("");
      expect(await readFile(join(h.dir, h.chapter[target].path), "utf8")).toBe(
        "用户已改动。"
      );
    }
  );

  it("checks the body again at the transaction boundary", async () => {
    const h = await fixture();
    const actual = longProjectIo.commitLongProjectTransaction;
    const hook = vi
      .spyOn(longProjectIo, "commitLongProjectTransaction")
      .mockImplementationOnce(async (...args) => {
        await writeFile(
          join(h.dir, h.chapter.body.path),
          "事务开始前的外部修改。",
          "utf8"
        );
        return actual(...args);
      });
    try {
      await expect(
        h.projectStore.commitChapter(h.dir, h.input)
      ).rejects.toThrow();
      expect(await readFile(join(h.dir, h.chapter.handoff.path), "utf8")).toBe(
        ""
      );
      expect(
        (await h.projectStore.openBook(h.dir)).book.workspaceIndex.ledger
          .commits
      ).toHaveLength(0);
    } finally {
      hook.mockRestore();
    }
  });

  it("rejects invalid final content before creating any file", async () => {
    const h = await fixture();
    h.input.preparation!.batch.documentWrites.find(
      (w) => w.fileId === h.chapter.handoff.id
    )!.content = " ";
    await expect(h.projectStore.commitChapter(h.dir, h.input)).rejects.toThrow(
      "尚未写入"
    );
    expect(
      (await h.projectStore.openBook(h.dir)).book.workspaceIndex.ledger.commits
    ).toHaveLength(0);
    expect(
      await readFile(join(h.dir, h.chapter.characterState.path), "utf8")
    ).toBe("");
  });

  it("rejects writes outside checkpoint continuity and missing body version evidence", async () => {
    const h = await fixture();
    const write = h.input.preparation!.batch.documentWrites[0]!;
    write.fileId = h.chapter.body.id;
    await expect(h.projectStore.commitChapter(h.dir, h.input)).rejects.toThrow(
      "连续性文件"
    );
    h.input.preparation!.bodyVersions = [];
    await expect(
      h.projectStore.commitChapter(h.dir, h.input)
    ).rejects.toThrow();
    expect(await readFile(join(h.dir, h.chapter.body.path), "utf8")).toBe(
      "合成章节正文。"
    );
  });
});

describe("continuity body evidence", () => {
  it("marks changed body as needing review and clears it only after checked review of the same batch", async () => {
    const h = await fixture();
    const committed = await h.projectStore.commitChapter(h.dir, h.input);
    const evidence = committed.record.bodyEvidence!;
    expect(evidence).toHaveLength(1);
    await h.projectStore.writeDocument(h.dir, {
      fileId: h.chapter.body.id,
      content: "修改后的合成正文。"
    });
    let index = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    expect(index.ledger.commits[0]!.changedChapterIds).toEqual([
      h.chapter.chapterCardId
    ]);
    const commit = index.ledger.commits[0]!;
    const ids = [
      commit.recordFile.id,
      h.chapter.body.id,
      ...committed.record.continuityFiles.map((f) => f.fileId)
    ];
    const { projectTransactionContentSha256 } =
      await import("./project-transaction");
    const versions = await Promise.all(
      ids.map(async (fileId) => ({
        fileId,
        expectedSha256: projectTransactionContentSha256(
          (await h.projectStore.readDocument(h.dir, { fileId })).content
        )
      }))
    );
    const review = {
      mode: "text_files_batch" as const,
      chapterCardIds: [h.chapter.chapterCardId],
      checkpointChapterCardId: h.chapter.chapterCardId,
      commitMessage: "已核对，措辞修改未改变连续性。",
      foreshadowingBeatDecisions: {},
      review: { commitId: commit.id, versions }
    };
    await expect(
      h.projectStore.commitChapter(h.dir, {
        ...review,
        review: { ...review.review, versions: versions.slice(1) }
      })
    ).rejects.toMatchObject({ code: "invalid_document_write" });
    await h.projectStore.commitChapter(h.dir, review);
    index = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    expect(index.ledger.commits).toHaveLength(1);
    expect(index.ledger.commits[0]!.id).toBe(commit.id);
    expect(index.ledger.commits[0]!.changedChapterIds).toEqual([]);
    expect(index.ledger.commits[0]!.bodyEvidence).not.toEqual(evidence);
    await h.projectStore.writeDocument(h.dir, {
      fileId: h.chapter.body.id,
      content: "复核后又发生的修改。"
    });
    await expect(
      h.projectStore.commitChapter(h.dir, review)
    ).rejects.toMatchObject({ code: "document_changed" });
    index = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
    expect(index.ledger.commits[0]!.changedChapterIds).toEqual([
      h.chapter.chapterCardId
    ]);
  });

  it("keeps identical writes current and recognizes a body restored to its recorded text", async () => {
    const h = await fixture();
    await h.projectStore.commitChapter(h.dir, h.input);
    for (const content of ["合成章节正文。", "临时改动。", "合成章节正文。"]) {
      await h.projectStore.writeDocument(h.dir, {
        fileId: h.chapter.body.id,
        content
      });
      const index = (await h.projectStore.openBook(h.dir)).book.workspaceIndex;
      expect(index.ledger.commits[0]!.changedChapterIds).toEqual(
        content === "临时改动。" ? [h.chapter.chapterCardId] : []
      );
    }
  });
});
