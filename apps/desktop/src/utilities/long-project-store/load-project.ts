import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  assertLongProjectIndexMetadata,
  createLongBookSummary,
  type LongBook
} from "@deepwrite/contracts";
import { recoverProjectTransaction } from "../project-transaction";
import { validatePortableAndCanonicalPaths } from "./integrity";
import { parseJson, readSecureTextFile, secureDirectory } from "./io";
import {
  migrateLegacyChapterBodyStatus,
  migrateLegacyChapterCardContent
} from "./migrations/chapter-card";
import {
  migrateLegacyChapterContinuityFiles,
  migrateLegacyStructuredContinuityFiles
} from "./migrations/continuity";
import { migrateLegacyArcOutlineToStoryPlots } from "./migrations/story-plots";
import {
  migrateLegacyCharacterOverviewStorage,
  migrateLegacyCharacterStateFiles,
  migrateLegacyCharacterTypes,
  migrateLegacyWorldbuildingStorage
} from "./migrations/world-character";
import { migrateLegacyLongVersionMetadata } from "./migrations/version-metadata";
import { indexedFileSlots } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_INDEX_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_MANIFEST_BYTES,
  type IndexedFileDescriptor,
  type LoadedLongProject
} from "./types";

export async function loadProject(
  ctx: LongProjectStoreContext,
  rawProjectDirectory: string
): Promise<LoadedLongProject> {
  let projectDirectory = await secureDirectory(
    rawProjectDirectory,
    "长篇项目目录"
  );
  // Mutable operations always receive a fresh snapshot, including after a
  // failed write. Never let their in-memory edits poison the read cache.
  const cached = ctx.projectReadCache.get(projectDirectory);
  if (cached) {
    ctx.projectReadCache.delete(projectDirectory);
    ctx.projectReadCacheCost -= cached.cost;
  }
  await recoverProjectTransaction(projectDirectory, MAX_LEDGER_RECORD_BYTES);
  projectDirectory = await secureDirectory(projectDirectory, "长篇项目目录");

  const manifestDisk = await readSecureTextFile(
    projectDirectory,
    MANIFEST_PATH,
    MAX_MANIFEST_BYTES
  );
  const rawManifest = parseJson(manifestDisk.content, "长篇项目 manifest");
  const indexDisk = await readSecureTextFile(
    projectDirectory,
    LONG_WORKSPACE_INDEX_PATH,
    MAX_INDEX_BYTES
  );
  const rawIndex = parseJson(indexDisk.content, "长篇工作区索引");
  if (
    await migrateLegacyLongVersionMetadata({
      projectDirectory,
      rawManifest,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  const manifest = LongProjectManifestSchema.parse(rawManifest);
  if (
    await migrateLegacyCharacterTypes({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterBodyStatus({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyWorldbuildingStorage({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyCharacterOverviewStorage({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyArcOutlineToStoryPlots({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterCardContent({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterContinuityFiles({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyStructuredContinuityFiles({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyCharacterStateFiles({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  const index = LongWorkspaceIndexSnapshotSchema.parse(rawIndex);
  assertLongProjectIndexMetadata(manifest, index);

  const slots = indexedFileSlots(index);
  validatePortableAndCanonicalPaths(slots);
  const files = new Map<string, IndexedFileDescriptor>();
  for (const slot of slots) {
    files.set(slot.reference.id, {
      reference: slot.reference,
      kind: slot.kind,
      disk: null
    });
  }

  // Opening validates the compact manifest and workspace index. Potentially
  // large Markdown bodies and ledger records are read only on demand.
  // Both components were validated above, including the shared id/timestamp
  // invariants. Parsing LongBook again would revalidate the entire index.
  const book: LongBook = {
    schemaVersion: index.schemaVersion,
    id: manifest.id,
    title: manifest.title,
    bookType: "long",
    genre: manifest.genre,
    status: manifest.status,
    linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
    linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
    linkedResourceStageScopes: manifest.linkedResourceStageScopes,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    workspaceIndex: index
  };
  const summary = createLongBookSummary(book);
  return {
    projectDirectory,
    manifest,
    manifestDisk,
    index,
    indexDisk,
    files,
    book,
    summary
  };
}
