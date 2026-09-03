import {
  LONG_WORKSPACE_INDEX_PATH,
  LongDeleteLedgerCommitInputSchema,
  LongDeleteLedgerCommitResultSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitChapterIds,
  type LongDeleteLedgerCommitResult
} from "@deepwrite/contracts";
import { deriveLongForeshadowingStatus } from "./continuity";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { contiguousRecordedThrough } from "./paths";
import { rebuildLongContinuityProjection } from "./rebuild-ledger-projection";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type StoreDeleteLongLedgerCommitInput
} from "./types";

export async function deleteLedgerCommit(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  rawInput: StoreDeleteLongLedgerCommitInput
): Promise<LongDeleteLedgerCommitResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const input = LongDeleteLedgerCommitInputSchema.parse({
      ...rawInput,
      bookId: loaded.manifest.id
    });
    const latest = loaded.index.ledger.commits.at(-1);
    if (!latest) {
      throw new Error("当前连续性账本没有可删除的提交记录。");
    }
    if (latest.id !== input.commitId) {
      throw new Error("只能删除连续性账本的最后一条提交记录。");
    }

    const chapterCardIds = longLedgerCommitChapterIds(latest);
    const chapterIdSet = new Set(chapterCardIds);
    loaded.index.ledger.commits = loaded.index.ledger.commits.slice(0, -1);
    for (const chapter of loaded.index.chapters) {
      if (chapterIdSet.has(chapter.chapterCardId)) chapter.commitId = null;
    }
    for (const placement of loaded.index.plot.narrativePlacements) {
      if (placement.commitId !== latest.id) continue;
      placement.commitId = null;
      placement.status = "planned";
    }
    for (const thread of loaded.index.plot.foreshadowing) {
      let changed = false;
      for (const beat of thread.beats) {
        if (beat.commitId !== latest.id) continue;
        beat.commitId = null;
        beat.status = "planned";
        changed = true;
      }
      if (changed) thread.status = deriveLongForeshadowingStatus(thread);
    }

    loaded.index.ledger.committedThroughChapterId = contiguousRecordedThrough(
      loaded.index
    );
    loaded.index.ledger.projection = await rebuildLongContinuityProjection(
      loaded,
      loaded.index.ledger.commits
    );

    const timestamp = ctx.timestamp();
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { action: "delete", path: latest.recordFile.path },
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: serializeJson(nextIndex)
        },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });

    return LongDeleteLedgerCommitResultSchema.parse({
      bookId: loaded.manifest.id,
      deletedCommitId: latest.id,
      chapterCardIds
    });
  });
}
