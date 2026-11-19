import {
  LongLedgerCommitRecordSchema,
  LongLedgerCommitIdSchema,
  type LongCommitChapterResult,
  type LongTextFilesBatchCommitInput,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { reviewContinuityCommit } from "./review-continuity-commit";
import { prepareContinuityCommit } from "./prepare-continuity-commit";
import { loadIndexedFile } from "./cache";
import {
  applyChapterDecisions,
  collectChapterBatchCommitTargets,
  committedThroughChapterId,
  finishChapterCommit
} from "./commit-chapter-common";
import { assertExactDecisionIds } from "./integrity";
import { orderedChapterCards } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import type { LoadedLongProject } from "./types";

export async function commitTextFilesBatch(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  input: LongTextFilesBatchCommitInput,
  managedCommitId?: string
): Promise<LongCommitChapterResult> {
  if (input.review) return reviewContinuityCommit(ctx, loaded, input);
  managedCommitId ??= input.preparation?.commitId;
  if (managedCommitId) {
    LongLedgerCommitIdSchema.parse(managedCommitId);
    const existing = loaded.index.ledger.commits.find(
      ({ id }) => id === managedCommitId
    );
    if (existing) {
      const recordFile = await loadIndexedFile(loaded, existing.recordFile.id);
      const record = LongLedgerCommitRecordSchema.parse(
        JSON.parse(recordFile.disk.content)
      );
      if (
        existing.mode !== "text_files_batch" ||
        JSON.stringify(record.chapterCardIds) !==
          JSON.stringify(input.chapterCardIds)
      )
        throw new Error("账本操作标识对应另一批章节。");
      return { record };
    }
  }
  let chapterEntries = resolveBatchEntries(loaded.index, input.chapterCardIds);

  const bodies = await Promise.all(
    chapterEntries.map(
      async (entry) => await loadIndexedFile(loaded, entry.body.id)
    )
  );
  const emptyBody = bodies.find(({ disk }) => !disk.content.trim());
  if (emptyBody) {
    throw new Error(`批量提交前必须完成章节正文：${emptyBody.reference.path}`);
  }

  const prepared = input.preparation
    ? await prepareContinuityCommit(
        loaded,
        input.preparation,
        input.chapterCardIds
      )
    : undefined;
  // Preparation replaces the index, including the objects changed by the commit.
  if (prepared)
    chapterEntries = resolveBatchEntries(loaded.index, input.chapterCardIds);
  const targets = collectChapterBatchCommitTargets(
    loaded.index,
    input.chapterCardIds
  );
  assertExactDecisionIds(
    "伏笔触点",
    targets.beats.map(({ id }) => id),
    Object.keys(input.foreshadowingBeatDecisions)
  );
  const checkpointEntry = chapterEntries.at(-1)!;
  const continuityReferences = [
    checkpointEntry.characterState,
    checkpointEntry.handoff,
    ...(targets.beats.length > 0 ? [checkpointEntry.foreshadowingChanges] : []),
    ...(checkpointEntry.worldReveals ? [checkpointEntry.worldReveals] : []),
    ...checkpointEntry.characterContinuity.flatMap((entry) => [
      entry.currentState,
      entry.history
    ])
  ];
  const continuityFiles = await Promise.all(
    continuityReferences.map(async (reference) =>
      prepared?.contents.has(reference.id)
        ? { reference, disk: { content: prepared.contents.get(reference.id)! } }
        : await loadIndexedFile(loaded, reference.id)
    )
  );
  for (const file of continuityFiles) {
    if (!file.disk.content.trim()) {
      throw new Error(`批次末章连续性文件尚未写入内容：${file.reference.path}`);
    }
  }

  const commitId = managedCommitId
    ? LongLedgerCommitIdSchema.parse(managedCommitId)
    : createId("commit");
  const timestamp = ctx.timestamp();
  const semanticChanges = applyChapterDecisions({
    index: loaded.index,
    targets,
    commitId,
    placementDecisions: null,
    beatDecisions: input.foreshadowingBeatDecisions
  });
  const record = LongLedgerCommitRecordSchema.parse({
    schemaVersion: 5,
    id: commitId,
    bookId: loaded.manifest.id,
    sequence: (loaded.index.ledger.commits.at(-1)?.sequence ?? 0) + 1,
    chapterCardId: input.checkpointChapterCardId,
    chapterCardIds: input.chapterCardIds,
    checkpointChapterCardId: input.checkpointChapterCardId,
    committedAt: timestamp,
    commitMessage: input.commitMessage,
    committedThroughChapterId: committedThroughChapterId(
      loaded.index,
      input.chapterCardIds
    ),
    ...semanticChanges,
    continuityFiles: continuityFiles.map((file) => ({
      fileId: file.reference.id,
      path: file.reference.path
    }))
  });
  return await finishChapterCommit({
    ctx,
    loaded,
    chapterEntries,
    record,
    mode: "text_files_batch",
    ...(prepared
      ? {
          fileOperations: prepared.fileOperations,
          versionWrites: prepared.versionWrites,
          ...(input.preparation?.versionOrigin
            ? { versionOrigin: input.preparation.versionOrigin }
            : {}),
          preservePreconditions: true
        }
      : {})
  });
}

function resolveBatchEntries(
  index: LongWorkspaceIndexSnapshot,
  chapterCardIds: readonly string[]
): LongWorkspaceIndexSnapshot["chapters"] {
  const orderedIds = orderedChapterCards(index).map(({ id }) => id);
  const firstPosition = orderedIds.indexOf(chapterCardIds[0]!);
  const expectedIds =
    firstPosition < 0
      ? []
      : orderedIds.slice(firstPosition, firstPosition + chapterCardIds.length);
  if (
    expectedIds.length !== chapterCardIds.length ||
    expectedIds.some((id, index) => id !== chapterCardIds[index])
  ) {
    throw new Error("批量提交只支持按叙事顺序排列的连续章节。");
  }

  const entryByChapterId = new Map(
    index.chapters.map((entry) => [entry.chapterCardId, entry])
  );
  return chapterCardIds.map((chapterCardId) => {
    const entry = entryByChapterId.get(chapterCardId);
    if (!entry || entry.commitId !== null) {
      throw new Error(`章节不存在或已经有连续性记录：${chapterCardId}`);
    }
    if (entry.bodyStatus !== "written") {
      throw new Error(`只有正文已经完成的章节才能批量提交：${chapterCardId}`);
    }
    return entry;
  });
}
