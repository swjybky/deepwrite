import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationError,
  type LongBookSummary
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { validatePortableAndCanonicalPaths } from "./integrity";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { indexedFileSlots } from "./paths";
import { revertJson } from "./restore-merge";
import {
  readProjectFileText,
  readRestorePoint,
  removeRestorePoint,
  sha256Text
} from "./restore-points";
import type { LongProjectStoreContext } from "./store-context";
import { MANIFEST_PATH, MAX_LEDGER_RECORD_BYTES } from "./types";

const MAX_LISTED_CONFLICTS = 3;

function conflictError(
  conflicts: readonly string[]
): LongWorkspaceOperationError {
  const listed = conflicts.slice(0, MAX_LISTED_CONFLICTS).join("；");
  const more =
    conflicts.length > MAX_LISTED_CONFLICTS ? ` 等 ${conflicts.length} 处` : "";
  return new LongWorkspaceOperationError(
    "restore_conflict",
    `这次修改之后相关内容又有变化，未撤销：${listed}${more}。请先撤销之后的修改，或手动调整。`
  );
}

export interface RestoreWorkspaceOperationsResult {
  summary: LongBookSummary;
  restoredFileCount: number;
}

/**
 * Undo one accepted batch from its restore point. Later, unrelated changes
 * stay; anything the batch touched that changed again aborts the restore
 * before a single file is written.
 */
export async function restoreWorkspaceOperations(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  restorePointId: string
): Promise<RestoreWorkspaceOperationsResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const root = loaded.projectDirectory;
    const point = await readRestorePoint(
      root,
      loaded.index.bookId,
      restorePointId
    );
    const merged = revertJson(
      loaded.index,
      point.beforeIndex,
      point.afterIndex
    );
    const conflicts = [...merged.conflicts];
    const fileOperations: ProjectTransactionFileOperation[] = [];

    for (const file of point.files) {
      const current = await readProjectFileText(root, file.path);
      const currentSha = current === null ? null : sha256Text(current);
      const beforeSha = file.before === null ? null : sha256Text(file.before);
      if (currentSha === beforeSha) continue;
      if (currentSha !== file.afterSha256) {
        conflicts.push(`${file.path} 在之后又被修改`);
        continue;
      }
      fileOperations.push(
        file.before === null
          ? { action: "delete", path: file.path }
          : {
              path: file.path,
              content: file.before,
              ...(current === null ? { expectedSha256: null } : {})
            }
      );
    }
    if (conflicts.length) throw conflictError(conflicts);

    const now = ctx.timestamp();
    const parsedIndex = LongWorkspaceIndexSnapshotSchema.safeParse({
      ...(merged.value as object),
      updatedAt: now
    });
    if (!parsedIndex.success) {
      throw conflictError(["撤销后的结构引用不一致"]);
    }
    const nextIndex = parsedIndex.data;
    validatePortableAndCanonicalPaths(indexedFileSlots(nextIndex));
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: now,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: now
      }
    });
    await commitLongProjectTransaction({
      projectRoot: root,
      operations: [
        ...fileOperations,
        { path: LONG_WORKSPACE_INDEX_PATH, content: serializeJson(nextIndex) },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    ctx.documentReadCache.clear();
    ctx.documentReadCacheCost = 0;
    // The undo is spent; a second click must not replay it over newer work.
    await removeRestorePoint(root, restorePointId).catch(() => undefined);
    const next = await loadProject(ctx, root);
    return { summary: next.summary, restoredFileCount: fileOperations.length };
  });
}
