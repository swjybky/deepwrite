import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongFileIdSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longAgentsMdCharacterCount
} from "@deepwrite/contracts";
import { sliceAgentsMdContent, tryReadAgentsMdFile } from "./agents-md";
import { loadIndexedFile, sliceIndexedUnicodeCodePointPage } from "./cache";
import { assertDirectlyMutableDocument } from "./integrity";
import {
  boundedPositiveInteger,
  commitLongProjectTransaction,
  nonnegativeInteger,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { loadProjectForRead } from "./read-project";
import { updateChapterBodyStatus } from "./paths";
import { loadPublicPagedIndexedFile } from "./public-file-read";
import { encodeUtf8Strict } from "./utf8";
import type { LongProjectStoreContext } from "./store-context";
import {
  DEFAULT_READ_PAGE_CHARACTERS,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_READ_PAGE_CHARACTERS,
  type OpenedLongBook,
  type ReadLongDocumentInput,
  type ReadLongDocumentResult,
  type RenameLongBookInput,
  type UpdateLongBookBindingsInput,
  LongDocumentConflictError,
  type WriteLongDocumentInput,
  type WriteLongDocumentResult
} from "./types";

export async function openBook(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProjectForRead(ctx, canonical);
    return structuredClone({ book: loaded.book, summary: loaded.summary });
  });
}

export async function inspectBookManifest(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<{
  bookId: string;
  updatedAt: string;
}> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const { manifest } = await loadProjectForRead(ctx, canonical);
    return {
      bookId: manifest.id,
      updatedAt: manifest.updatedAt
    };
  });
}

export async function updateBindings(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: UpdateLongBookBindingsInput
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const timestamp = ctx.timestamp();
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: input.linkedSkillIdsByKind,
      linkedResourceStageScopes: input.linkedResourceStageScopes,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    return { book: next.book, summary: next.summary };
  });
}

export async function renameBook(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: RenameLongBookInput
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const timestamp = ctx.timestamp();
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      title: input.title,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    return { book: next.book, summary: next.summary };
  });
}

export async function readDocument(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: ReadLongDocumentInput
): Promise<ReadLongDocumentResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProjectForRead(ctx, canonical);
    if (input.bookId !== undefined && input.bookId !== loaded.manifest.id) {
      throw new Error("长篇项目标识与注册信息不一致。");
    }
    const fileId = LongFileIdSchema.parse(input.fileId);
    const file = await loadPublicPagedIndexedFile(ctx, loaded, fileId);
    const offset = nonnegativeInteger(input.offset ?? 0, "分页起点");
    const limit = boundedPositiveInteger(
      input.limit ?? DEFAULT_READ_PAGE_CHARACTERS,
      MAX_READ_PAGE_CHARACTERS,
      "分页长度"
    );
    const page = sliceIndexedUnicodeCodePointPage(file.paging, offset, limit);
    if (offset > page.totalCharacters) {
      throw new Error("长篇文档分页起点超过文件字符总数。");
    }
    return {
      fileId,
      // Keep public metadata tied to the index snapshot, as catalog.open did.
      // Physical mtime is only the internal text-cache invalidation key.
      file: { ...loaded.files.get(fileId)!.reference },
      path: file.reference.path,
      content: page.content,
      offset,
      nextOffset: page.nextOffset,
      totalCharacters: page.totalCharacters
    };
  });
}

export async function readAgentsMd(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<{ content: string; truncated: boolean }> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    const existing = await tryReadAgentsMdFile(canonical);
    if (!existing) {
      const content = DEFAULT_LONG_AGENTS_MD;
      await commitLongProjectTransaction({
        projectRoot: canonical,
        operations: [
          {
            path: LONG_AGENTS_MD_PATH,
            content,
            expectedSha256: null
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      return { content, truncated: false };
    }
    return sliceAgentsMdContent(existing.content);
  });
}

export async function writeAgentsMd(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  content: string
): Promise<void> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    if (longAgentsMdCharacterCount(content) > LONG_AGENTS_MD_MAX_CHARACTERS) {
      throw new Error(
        `长篇上下文超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符上限。`
      );
    }
    const existing = await tryReadAgentsMdFile(canonical);
    await commitLongProjectTransaction({
      projectRoot: canonical,
      operations: [
        {
          path: LONG_AGENTS_MD_PATH,
          content,
          ...(existing ? {} : { expectedSha256: null })
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
  });
}

export async function writeDocument(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: WriteLongDocumentInput
): Promise<WriteLongDocumentResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const fileId = LongFileIdSchema.parse(input.fileId);
    assertDirectlyMutableDocument(loaded.index, fileId);
    // Before loadIndexedFile, which replaces this index time with the mtime;
    // readDocument reports the index time, so that is what callers send back.
    if (
      input.expectedUpdatedAt !== undefined &&
      input.expectedUpdatedAt !== loaded.files.get(fileId)?.reference.updatedAt
    ) {
      throw new LongDocumentConflictError();
    }
    const file = await loadIndexedFile(loaded, fileId);
    if (file.kind !== "markdown") {
      throw new Error("第一阶段只允许通过 writeDocument 写入 Markdown 文件。");
    }
    const nextBytes = encodeUtf8Strict(input.content);
    if (nextBytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error("长篇 Markdown 文件超过 32 MiB 限制。");
    }
    const timestamp = ctx.timestamp();
    file.reference.updatedAt = timestamp;
    updateChapterBodyStatus(loaded.index, file.reference.id, input.content);

    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    const manifestContent = serializeJson(nextManifest);

    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: file.reference.path, content: input.content },
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: manifestContent }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });

    const next = await loadProject(ctx, loaded.projectDirectory);
    return {
      book: next.book,
      summary: next.summary,
      fileId
    };
  });
}
