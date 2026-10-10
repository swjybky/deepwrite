import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import { parseLongPortableExportBundle } from "../long-portable-bundle";
import {
  createContinuationImportPlan,
  previewContinuationImportSource,
  type ContinuationImportPlan
} from "../long-continuation-import";
import { readWriteClawLongImportPlan } from "../write-claw-long-import";
import { normalizeAgentsMdContent } from "./agents-md";
import {
  commitLongProjectTransaction,
  ensureSecureDirectory,
  readPortableBundleSource,
  requireMissing,
  serializeJson
} from "./io";
import {
  validateImportPlan,
  validatePortableAndCanonicalPaths
} from "./integrity";
import { loadProject } from "./load-project";
import {
  assertLongProjectIdAvailable,
  promoteLongProjectStaging
} from "./project-folder";
import { indexedFileSlots } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type ImportContinuationLongBookInput,
  type ImportWriteClawLongBookOptions,
  type ImportedContinuationLongBook,
  type ImportedPortableLongBook,
  type ImportedWriteClawLongBook
} from "./types";

export async function importWriteClawBook(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  sourcePath: string,
  options: ImportWriteClawLongBookOptions = {}
): Promise<ImportedWriteClawLongBook> {
  const parent = await ensureSecureDirectory(parentDirectory, "长篇项目父目录");
  return await ctx.runExclusive(parent, async () => {
    const plan = await readWriteClawLongImportPlan(sourcePath, {
      ...options,
      importedAt: ctx.timestamp()
    });
    const manifest = LongProjectManifestSchema.parse(plan.manifest);
    const index = LongWorkspaceIndexSnapshotSchema.parse(plan.index);
    validateImportPlan(plan, manifest, index);

    await assertLongProjectIdAvailable(parent, manifest.id);
    const stagingDirectory = join(
      parent,
      `.${manifest.id}.staging-${randomHex8()}`
    );
    await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
    await mkdir(stagingDirectory, { mode: 0o700 });

    try {
      await commitLongProjectTransaction({
        projectRoot: stagingDirectory,
        operations: [
          ...plan.documents.map((document) => ({
            path: document.path,
            content: document.content,
            expectedSha256: null as null
          })),
          {
            path: LONG_AGENTS_MD_PATH,
            content: DEFAULT_LONG_AGENTS_MD,
            expectedSha256: null
          },
          {
            path: LONG_WORKSPACE_INDEX_PATH,
            content: serializeJson(index),
            expectedSha256: null
          },
          {
            path: MANIFEST_PATH,
            content: serializeJson(manifest),
            expectedSha256: null
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      const staged = await loadProject(ctx, stagingDirectory);
      const projectDirectory = await promoteLongProjectStaging(
        parent,
        stagingDirectory,
        staged.book.title
      );
      const loaded = await loadProject(ctx, projectDirectory);
      return {
        projectDirectory: loaded.projectDirectory,
        book: loaded.book,
        summary: loaded.summary,
        sourceKind: plan.sourceKind,
        legacySchemaVersion: plan.legacySchemaVersion,
        committedChapterPolicy: plan.committedChapterPolicy,
        warnings: [...plan.warnings]
      };
    } catch (error: unknown) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function previewContinuationImport(
  ctx: LongProjectStoreContext,
  sourcePath: string
) {
  return await previewContinuationImportSource(sourcePath);
}

export async function importContinuationBook(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  input: ImportContinuationLongBookInput
): Promise<ImportedContinuationLongBook> {
  const parent = await ensureSecureDirectory(parentDirectory, "长篇项目父目录");
  return await ctx.runExclusive(parent, async () => {
    const plan = await createContinuationImportPlan(
      {
        parentDirectory: parent,
        sourcePath: input.sourcePath,
        expectedFingerprint: input.expectedFingerprint,
        title: input.title,
        genre: input.genre
      },
      ctx.timestamp()
    );
    return await commitContinuationImportPlan(ctx, parent, plan);
  });
}

export async function importPortableBundle(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  sourcePath: string
): Promise<ImportedPortableLongBook> {
  const parent = await ensureSecureDirectory(parentDirectory, "长篇项目父目录");
  return await ctx.runExclusive(parent, async () => {
    const source = await readPortableBundleSource(sourcePath);
    const bundle = parseLongPortableExportBundle(source);
    const manifest = LongProjectManifestSchema.parse(bundle.manifest.value);
    const index = LongWorkspaceIndexSnapshotSchema.parse(bundle.index.value);
    const slots = indexedFileSlots(index);
    validatePortableAndCanonicalPaths(slots);

    await assertLongProjectIdAvailable(parent, manifest.id);
    const stagingDirectory = join(
      parent,
      `.${manifest.id}.staging-${randomHex8()}`
    );
    await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
    await mkdir(stagingDirectory, { mode: 0o700 });

    try {
      await commitLongProjectTransaction({
        projectRoot: stagingDirectory,
        operations: [
          ...bundle.files.map((file) => ({
            path: file.path,
            content: file.content,
            expectedSha256: null as null
          })),
          {
            path: LONG_AGENTS_MD_PATH,
            content: normalizeAgentsMdContent(
              bundle.agentsMd ?? DEFAULT_LONG_AGENTS_MD
            ),
            expectedSha256: null
          },
          {
            path: LONG_WORKSPACE_INDEX_PATH,
            content: serializeJson(index),
            expectedSha256: null
          },
          {
            path: MANIFEST_PATH,
            content: serializeJson(manifest),
            expectedSha256: null
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      const staged = await loadProject(ctx, stagingDirectory);
      const projectDirectory = await promoteLongProjectStaging(
        parent,
        stagingDirectory,
        staged.book.title
      );
      const loaded = await loadProject(ctx, projectDirectory);
      return {
        projectDirectory: loaded.projectDirectory,
        book: loaded.book,
        summary: loaded.summary,
        exportedAt: bundle.exportedAt
      };
    } catch (error: unknown) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function commitContinuationImportPlan(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  plan: ContinuationImportPlan
): Promise<ImportedContinuationLongBook> {
  const manifest = LongProjectManifestSchema.parse(plan.manifest);
  const index = LongWorkspaceIndexSnapshotSchema.parse(plan.index);
  await assertLongProjectIdAvailable(parentDirectory, manifest.id);
  const stagingDirectory = join(
    parentDirectory,
    `.${manifest.id}.staging-${randomHex8()}`
  );
  await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
  await mkdir(stagingDirectory, { mode: 0o700 });
  try {
    await commitLongProjectTransaction({
      projectRoot: stagingDirectory,
      operations: [
        ...plan.documents.map((document) => ({
          path: document.path,
          content: document.content,
          expectedSha256: null as null
        })),
        {
          path: LONG_AGENTS_MD_PATH,
          content: DEFAULT_LONG_AGENTS_MD,
          expectedSha256: null
        },
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: serializeJson(index),
          expectedSha256: null
        },
        {
          path: MANIFEST_PATH,
          content: serializeJson(manifest),
          expectedSha256: null
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const staged = await loadProject(ctx, stagingDirectory);
    const projectDirectory = await promoteLongProjectStaging(
      parentDirectory,
      stagingDirectory,
      staged.book.title
    );
    const loaded = await loadProject(ctx, projectDirectory);
    return {
      projectDirectory: loaded.projectDirectory,
      book: loaded.book,
      summary: loaded.summary,
      importedVolumeCount: plan.importedVolumeCount,
      importedChapterCount: plan.importedChapterCount,
      checkpointCount: plan.checkpointCount,
      pendingChapterCardId: plan.pendingChapterCardId,
      warnings: [...plan.warnings]
    };
  } catch (error: unknown) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}
