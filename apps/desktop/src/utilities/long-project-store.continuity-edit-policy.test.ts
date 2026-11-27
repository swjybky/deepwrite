import {
  LongWorkspaceOperationError,
  createEnvelope,
  createEmptyLongMarkdownFileReference,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  longChapterForeshadowingChangesFileId,
  longChapterFilePath,
  longChapterContinuityFilePath,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  FIXED_NOW,
  createFixture,
  describe,
  expect,
  it,
  sha256Hex
} from "./long-project-store.test-support";
import { vi } from "vitest";
// This integration test exercises Renderer coordination against the real Core store.
import { useLongWorkspaceProposals } from "../renderer/src/composables/useLongWorkspaceProposals";
import type { LongWorkspaceRendererApi } from "../renderer/src/types/longWorkspace";

describe("latest continuity checkpoint editing", () => {
  it.each(["request-approval", "auto-approve"] as const)(
    "saves an edit arriving after archival in the same run (%s)",
    async (approvalMode) => {
      const { projectStore, created } = await createFixture("late-edit");
      const directory = created.projectDirectory;
      const chapter = created.book.workspaceIndex.chapters[0]!;
      const bookId = created.book.id;
      const title = created.book.workspaceIndex.plot.chapterCards[0]!.title;
      await projectStore.writeChapter(directory, {
        chapterCardId: chapter.chapterCardId,
        body: { content: "测试正文。" },
        characterState: { content: "原章末状态。" },
        handoff: { content: "原接续包。" }
      });
      const api = {
        getWorkspaceIndex: async () => ({
          bookId,
          workspaceIndex: (await projectStore.openBook(directory)).book
            .workspaceIndex
        }),
        previewOperations: async ({ batch }) => ({
          bookId,
          preview: await projectStore.previewWorkspaceOperations(
            directory,
            batch
          )
        }),
        applyOperations: async ({ batch }) => {
          const result = await projectStore.applyWorkspaceOperations(
            directory,
            { batch }
          );
          return {
            bookId,
            operationResult: result.operationResult,
            summary: result.summary
          };
        },
        commitChapter: async (input) =>
          projectStore.commitChapter(directory, input)
      } satisfies Pick<
        LongWorkspaceRendererApi,
        | "getWorkspaceIndex"
        | "previewOperations"
        | "applyOperations"
        | "commitChapter"
      >;
      const notifications = {
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      };
      const controller = useLongWorkspaceProposals({
        api: () => api as unknown as LongWorkspaceRendererApi,
        acceptsEvent: () => true,
        approvalModeForEvent: () => approvalMode,
        notifications
      });
      const base = {
        bookId,
        sessionId: "session_late_edit",
        runId: "run_late_edit",
        agentId: "long" as const,
        runtime: {
          provider: "deepwrite",
          model: "test",
          mode: "local-faux" as const
        }
      };
      await controller.handleEvent(
        createEnvelope(
          "long.ledger_commit_proposal",
          {
            ...base,
            toolCallId: "tool_commit",
            summary: "登记章节",
            input: {
              bookId,
              mode: "text_files" as const,
              chapterCardId: chapter.chapterCardId,
              foreshadowingBeatDecisions: {},
              commitMessage: "登记章节"
            }
          },
          { id: "event_commit" }
        )
      );
      expect(controller.itemsForBook(bookId)[0]?.status).toBe("accepted");
      const before = await projectStore.openBook(directory);

      const edit = createEnvelope(
        "long.continuity_file_proposal",
        {
          ...base,
          toolCallId: "tool_late_edit",
          summary: "归档后补写章末状态",
          batch: {
            updatedAt: FIXED_NOW,
            operations: [],
            documentWrites: [
              {
                proposalId: "proposal_late_edit",
                fileId: chapter.characterState.id,
                mode: "replace" as const,
                content: "补写后的章末状态。",
                expectedSha256: sha256Hex("原章末状态。"),
                updatedAt: FIXED_NOW,
                reason: "补写"
              }
            ]
          },
          files: [
            {
              chapterCardId: chapter.chapterCardId,
              role: "chapter_end_state" as const,
              characterId: null,
              fileId: chapter.characterState.id,
              filePath: chapter.characterState.path,
              title: `${title} / 章末状态`,
              operation: "write" as const,
              beforeText: "原章末状态。",
              afterText: "补写后的章末状态。"
            }
          ]
        },
        { id: "event_late_edit" }
      );
      await controller.handleEvent(edit);
      if (approvalMode === "request-approval")
        await controller.approve(bookId, edit.id);
      expect(
        controller
          .itemsForBook(bookId)
          .find((item) => item.event.id === edit.id)?.status
      ).toBe("accepted");
      expect(notifications.error).not.toHaveBeenCalled();
      await expect(
        projectStore.readDocument(directory, {
          fileId: chapter.characterState.id
        })
      ).resolves.toMatchObject({ content: "补写后的章末状态。" });
      const after = await projectStore.openBook(directory);
      expect(after.book.workspaceIndex.ledger).toEqual(
        before.book.workspaceIndex.ledger
      );
      expect(after.book.workspaceIndex.chapters[0]!.commitId).toBe(
        before.book.workspaceIndex.chapters[0]!.commitId
      );
    }
  );

  it("rechecks historical protection when another chapter commits after preview", async () => {
    const { projectStore, created } = await createFixture("historical-edit");
    const directory = created.projectDirectory;
    const first = created.book.workspaceIndex.chapters[0]!;
    await projectStore.writeChapter(directory, {
      chapterCardId: first.chapterCardId,
      body: { content: "第一章正文。" },
      characterState: { content: "第一章状态。" },
      handoff: { content: "第一章接续。" }
    });
    const committed = await projectStore.commitChapter(directory, {
      mode: "text_files",
      chapterCardId: first.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "第一章归档"
    });
    const batch: LongWorkspaceOperationBatch = {
      updatedAt: FIXED_NOW,
      operations: [],
      documentWrites: [
        {
          proposalId: "proposal_historical",
          fileId: first.handoff.id,
          mode: "replace",
          content: "待保存的修订。",
          updatedAt: FIXED_NOW,
          reason: "修订最新章节"
        }
      ]
    };
    const preview = await projectStore.previewWorkspaceOperations(
      directory,
      batch
    );
    const secondId = "chapter_second";
    const file = (id: string, path: string) =>
      createEmptyLongMarkdownFileReference(id, path, FIXED_NOW);
    await projectStore.applyWorkspaceOperations(directory, {
      batch: {
        updatedAt: FIXED_NOW,
        documentWrites: [],
        operations: [
          {
            type: "chapter.create",
            chapterCard: {
              id: secondId,
              title: "第二章",
              narrativeOrder: 2,
              volumeId: created.book.workspaceIndex.plot.volumes[0]!.id,
              primaryArcId: null
            },
            files: {
              chapterCardId: secondId,
              bodyStatus: "empty",
              commitId: null,
              body: file(
                longChapterBodyFileId(secondId),
                longChapterFilePath(secondId, "body.md")
              ),
              card: file(
                longChapterCardFileId(secondId),
                longChapterFilePath(secondId, "card.md")
              ),
              characterState: file(
                longChapterCharacterStateFileId(secondId),
                longChapterFilePath(secondId, "character-state.md")
              ),
              handoff: file(
                longChapterHandoffFileId(secondId),
                longChapterFilePath(secondId, "handoff.md")
              ),
              foreshadowingChanges: file(
                longChapterForeshadowingChangesFileId(secondId),
                longChapterContinuityFilePath(
                  secondId,
                  "foreshadowing-changes.md"
                )
              ),
              worldReveals: null,
              characterContinuity: []
            }
          }
        ]
      }
    });
    const opened = await projectStore.openBook(directory);
    const second = opened.book.workspaceIndex.chapters[1]!;
    expect(second).toBeDefined();
    await projectStore.writeChapter(directory, {
      chapterCardId: second.chapterCardId,
      body: { content: "第二章正文。" },
      characterState: { content: "第二章状态。" },
      handoff: { content: "第二章接续。" }
    });
    const latest = await projectStore.commitChapter(directory, {
      mode: "text_files",
      chapterCardId: second.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "第二章归档"
    });
    const denied = { code: "historical_continuity_readonly" };
    await expect(
      projectStore.previewWorkspaceOperations(directory, batch)
    ).rejects.toMatchObject(denied);
    await expect(
      projectStore.applyWorkspaceOperations(directory, {
        batch: { ...batch, expectedImpact: preview.confirmation }
      })
    ).rejects.toMatchObject(denied);
    await expect(
      projectStore.writeDocument(directory, {
        fileId: first.handoff.id,
        content: "不应覆盖历史。"
      })
    ).rejects.toBeInstanceOf(LongWorkspaceOperationError);
    await expect(
      projectStore.writeChapter(directory, {
        chapterCardId: first.chapterCardId,
        body: { content: "不应部分落盘" },
        characterState: { content: "不应部分落盘" },
        handoff: { content: "不应部分落盘" }
      })
    ).rejects.toMatchObject(denied);
    await expect(
      projectStore.readDocument(directory, { fileId: first.body.id })
    ).resolves.toMatchObject({ content: "第一章正文。" });
    await expect(
      projectStore.readDocument(directory, { fileId: first.handoff.id })
    ).resolves.toMatchObject({ content: "第一章接续。" });
    await projectStore.deleteLedgerCommit(directory, {
      commitId: latest.record.id
    });
    await projectStore.writeDocument(directory, {
      fileId: first.handoff.id,
      content: "恢复为最新后可修改。"
    });
    const restored = await projectStore.openBook(directory);
    expect(restored.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    await expect(
      projectStore.readDocument(directory, { fileId: first.handoff.id })
    ).resolves.toMatchObject({ content: "恢复为最新后可修改。" });
  });
});
