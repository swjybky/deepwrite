import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  applyLongWorkspaceOperations,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  previewLongWorkspaceOperations
} from "@deepwrite/contracts/renderer";
import { describe, expect, it } from "vitest";
import {
  buildLongNavigationDeleteBatch,
  createLongNavigationDeletePreviewTimes
} from "./navigation-delete-batch";

const INITIAL_AT = "2026-08-31T07:00:00.000Z";
const PREVIEW_AT = "2026-08-31T08:00:00.000Z";
const CONFIRM_AT = "2026-08-31T08:01:00.000Z";
const BOOK_ID = "longbook_delete_confirmation";

function file(id: string, path: string, updatedAt = INITIAL_AT) {
  return { id, path, updatedAt };
}

function chapterFiles(chapterCardId: string, commitId: string | null) {
  const directory = `long/chapters/${chapterCardId}`;
  return {
    chapterCardId,
    body: file(longChapterBodyFileId(chapterCardId), `${directory}/body.md`),
    card: file(longChapterCardFileId(chapterCardId), `${directory}/card.md`),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `${directory}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `${directory}/handoff.md`
    ),
    bodyStatus: "empty" as const,
    commitId
  };
}

function committedWorkspaceWithEmptyChapter(): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: BOOK_ID,
    updatedAt: INITIAL_AT,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    worldbuilding: [],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [{ id: "volume_one", title: "第一卷", order: 1, summary: "" }],
      arcs: [],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: null,
          title: "第一章",
          narrativeOrder: 1
        },
        {
          id: "chapter_empty",
          volumeId: "volume_one",
          primaryArcId: null,
          title: "空白章节",
          narrativeOrder: 2
        }
      ],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [
      chapterFiles("chapter_one", "commit_first"),
      chapterFiles("chapter_empty", null)
    ],
    ledger: {
      committedThroughChapterId: "chapter_one",
      commits: [
        {
          id: "commit_first",
          mode: "structured",
          sequence: 1,
          chapterCardId: "chapter_one",
          committedAt: INITIAL_AT,
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile: file(
            "file_commit_first:ledger",
            "long/ledger/commit-first.json"
          )
        }
      ]
    }
  });
}

const loadMutationModule = () => import("../../types/longStructureMutations");

describe("navigation deletion batch confirmation", () => {
  it("ignores a late preview for the same deletion target", () => {
    const input = {
      kind: "chapterCard" as const,
      id: "chapter_empty"
    };
    const previewTimes = createLongNavigationDeletePreviewTimes();
    const first = previewTimes.begin(BOOK_ID, input);
    const second = previewTimes.begin(BOOK_ID, input);

    previewTimes.remember(BOOK_ID, input, CONFIRM_AT, second);
    previewTimes.remember(BOOK_ID, input, PREVIEW_AT, first);

    expect(previewTimes.timestampFor(BOOK_ID, input)).toBe(CONFIRM_AT);
  });

  it("keeps an empty-chapter confirmation stable when ledger cleanup is present", async () => {
    const source = committedWorkspaceWithEmptyChapter();
    const input = {
      kind: "chapterCard" as const,
      id: "chapter_empty",
      title: "空白章节"
    };
    const previewTimes = createLongNavigationDeletePreviewTimes();
    const previewDeletion = await buildLongNavigationDeleteBatch(
      loadMutationModule,
      source,
      input,
      PREVIEW_AT
    );
    const preview = previewLongWorkspaceOperations(
      source,
      previewDeletion.batch
    );
    expect(preview.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_first",
        recordFile: expect.objectContaining({ updatedAt: PREVIEW_AT })
      })
    ]);
    const previewRequest = previewTimes.begin(BOOK_ID, input);
    previewTimes.remember(
      BOOK_ID,
      input,
      previewDeletion.batch.updatedAt,
      previewRequest
    );

    const independentlyRebuilt = await buildLongNavigationDeleteBatch(
      loadMutationModule,
      source,
      input,
      CONFIRM_AT
    );
    expect(
      previewLongWorkspaceOperations(source, independentlyRebuilt.batch)
        .confirmation
    ).not.toEqual(preview.confirmation);

    const confirmedDeletion = await buildLongNavigationDeleteBatch(
      loadMutationModule,
      source,
      input,
      previewTimes.timestampFor(BOOK_ID, input)
    );
    expect(confirmedDeletion.batch.updatedAt).toBe(PREVIEW_AT);
    expect(
      previewLongWorkspaceOperations(source, confirmedDeletion.batch)
        .confirmation
    ).toEqual(preview.confirmation);
    expect(() =>
      applyLongWorkspaceOperations(source, {
        ...confirmedDeletion.batch,
        expectedImpact: preview.confirmation
      })
    ).not.toThrow();
  });
});
