import { createHash } from "node:crypto";
import { dirname } from "node:path";
import {
  LongApplyOperationsInputSchema,
  LongApplyOperationsResultSchema,
  LongApplyLegacySyncAtPathInputSchema,
  LongApplyLegacySyncResultSchema,
  LongBookSummarySchema,
  LongCommitChapterInputSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitInputSchema,
  LongDeleteLedgerCommitResultSchema,
  LongDuplicateBookInputSchema,
  LongPreviewContinuationImportAtPathResultSchema,
  LongPreviewLegacySyncAtPathResultSchema,
  LongListBooksResultSchema,
  LongOpenBookInputSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsInputSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentInputSchema,
  LongReadDocumentResultSchema,
  LongReadAgentsMdInputSchema,
  LongReadAgentsMdResultSchema,
  LongRenameBookInputSchema,
  LongRemoveBookInputSchema,
  LongRemoveBookResultSchema,
  LongSearchInputSchema,
  LongSearchResultSchema,
  LongUpdateBindingsInputSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterInputSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentInputSchema,
  LongWriteDocumentResultSchema,
  LongWriteAgentsMdInputSchema,
  LongWriteAgentsMdResultSchema,
  type CreateLongBookInput,
  type LongApplyOperationsInput,
  type LongApplyOperationsResult,
  type LongApplyLegacySyncAtPathInput,
  type LongApplyLegacySyncResult,
  type LongBookSummary,
  type LongCommitChapterInput,
  type LongCommitChapterResult,
  type LongDeleteLedgerCommitInput,
  type LongDeleteLedgerCommitResult,
  type LongDuplicateBookInput,
  type LongImportContinuationAtPathInput,
  type LongPreviewContinuationImportAtPathResult,
  type LongPreviewLegacySyncAtPathResult,
  type LongListBooksResult,
  type LongOpenBookInput,
  type LongOpenBookResult,
  type LongPreviewOperationsInput,
  type LongPreviewOperationsResult,
  type LongReadDocumentInput,
  type LongReadDocumentResult,
  type LongReadAgentsMdInput,
  type LongReadAgentsMdResult,
  type LongRenameBookInput,
  type LongRemoveBookInput,
  type LongRemoveBookResult,
  type LongSearchInput,
  type LongSearchResult,
  type LongUpdateBindingsInput,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexResult,
  type LongWorkspaceRoot,
  type LongWriteChapterInput,
  type LongWriteChapterResult,
  type LongWriteDocumentInput,
  type LongWriteDocumentResult,
  type LongWriteAgentsMdInput,
  type LongWriteAgentsMdResult
} from "@deepwrite/contracts";
import {
  LongProjectCatalog,
  type OpenLongProject
} from "./long-project-catalog";
import {
  LongProjectStore,
  type CreateLongBookInput as StoreCreateLongBookInput,
  type ImportedPortableLongBook,
  type ImportedContinuationLongBook,
  type ImportedWriteClawLongBook,
  type ImportWriteClawLongBookOptions,
  type LongProjectSearchResume
} from "./long-project-store";
import {
  buildWriteClawLongSync,
  previewWriteClawLongSync
} from "./write-claw-long-sync";
import { nextCopyTitle } from "./copy-title";

interface IndexedSearchFile {
  file: LongWorkspaceFileReference;
  root: LongWorkspaceRoot;
  title: string;
}

export interface LongWorkspaceServiceOptions {
  userDataPath: string;
  now?: () => string;
  onDiagnostic?: (diagnostic: LongWorkspaceServiceDiagnostic) => void;
}

export interface LongWorkspaceServiceDiagnostic {
  code: "catalog-summary-cache-update-failed";
  bookId: string;
  operation:
    | "update-bindings"
    | "rename-book"
    | "write-document"
    | "write-chapter"
    | "commit-chapter"
    | "delete-ledger-commit"
    | "apply-operations";
  message: string;
  occurredAt: string;
}

/**
 * Core-facing facade that composes the independent registry and physical
 * store. All public calls are keyed by bookId; raw project paths are confined
 * to create/open registration flows.
 */
export class LongWorkspaceService {
  readonly store: LongProjectStore;
  readonly catalog: LongProjectCatalog;

  private readonly now: () => string;
  private readonly onDiagnostic:
    ((diagnostic: LongWorkspaceServiceDiagnostic) => void) | undefined;
  private readonly diagnostics: LongWorkspaceServiceDiagnostic[] = [];

  constructor(options: LongWorkspaceServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.onDiagnostic = options.onDiagnostic;
    this.store = new LongProjectStore(options.now ? { now: options.now } : {});
    this.catalog = new LongProjectCatalog({
      userDataPath: options.userDataPath,
      ...(options.now ? { now: options.now } : {}),
      projects: {
        createBook: async (parentDirectory, input) => {
          return await this.store.createBook(
            parentDirectory,
            normalizeCreateInput(input)
          );
        },
        openBook: async (projectDirectory) => {
          const opened = await this.store.openBook(projectDirectory);
          return { projectDirectory, ...opened };
        },
        inspectBook: async (projectDirectory) => {
          return await this.store.inspectBookManifest(projectDirectory);
        }
      }
    });
  }

  async create(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<LongOpenBookResult> {
    const opened = await this.catalog.create(parentDirectory, input);
    return parseOpenResult(opened);
  }

  async duplicateBook(
    input: LongDuplicateBookInput
  ): Promise<LongOpenBookResult> {
    const parsed = LongDuplicateBookInputSchema.parse(input);
    const source = await this.catalog.open(parsed.bookId);
    const listed = LongListBooksResultSchema.parse(await this.catalog.list());
    const title = nextCopyTitle(
      source.summary.title,
      listed.books.map((book) => book.title)
    );
    const duplicated = await this.store.duplicateBook(
      dirname(source.projectDirectory),
      source.projectDirectory,
      title
    );
    return parseOpenResult(
      await this.catalog.openAtPath(duplicated.projectDirectory)
    );
  }

  async importWriteClawBook(
    parentDirectory: string,
    sourcePath: string,
    options: ImportWriteClawLongBookOptions = {}
  ): Promise<ImportedWriteClawLongBook> {
    const imported = await this.store.importWriteClawBook(
      parentDirectory,
      sourcePath,
      options
    );
    const registered = await this.catalog.openAtPath(imported.projectDirectory);
    return {
      ...imported,
      projectDirectory: registered.projectDirectory,
      book: registered.book,
      summary: registered.summary
    };
  }

  async previewContinuationImport(
    sourcePath: string
  ): Promise<LongPreviewContinuationImportAtPathResult> {
    return LongPreviewContinuationImportAtPathResultSchema.parse(
      await this.store.previewContinuationImport(sourcePath)
    );
  }

  async previewLegacySync(
    sourcePath: string
  ): Promise<LongPreviewLegacySyncAtPathResult> {
    return LongPreviewLegacySyncAtPathResultSchema.parse(
      await previewWriteClawLongSync(sourcePath)
    );
  }

  async applyLegacySync(
    input: LongApplyLegacySyncAtPathInput
  ): Promise<LongApplyLegacySyncResult> {
    const parsed = LongApplyLegacySyncAtPathInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const bookLineParts: string[] = [];
    let bookLineOffset = 0;
    while (true) {
      const page = await this.store.readDocument(opened.projectDirectory, {
        fileId: opened.book.workspaceIndex.bookLine.id,
        offset: bookLineOffset,
        limit: 262_144
      });
      bookLineParts.push(page.content);
      if (page.nextOffset === null) break;
      bookLineOffset = page.nextOffset;
    }
    const sync = await buildWriteClawLongSync({
      sourcePath: parsed.sourcePath,
      expectedFingerprint: parsed.expectedFingerprint,
      modules: parsed.modules,
      target: opened.book.workspaceIndex,
      targetBookLineContent: bookLineParts.join(""),
      updatedAt: this.now()
    });
    if (!sync.batch) {
      return LongApplyLegacySyncResultSchema.parse({
        bookId: parsed.bookId,
        summary: opened.summary,
        imported: sync.imported,
        skipped: sync.skipped,
        warnings: sync.warnings
      });
    }
    const applied = await this.store.applyWorkspaceOperations(
      opened.projectDirectory,
      {
        batch: sync.batch
      }
    );
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      applied.summary,
      "apply-operations"
    );
    return LongApplyLegacySyncResultSchema.parse({
      bookId: parsed.bookId,
      summary: applied.summary,
      imported: sync.imported,
      skipped: sync.skipped,
      warnings: sync.warnings
    });
  }

  async importContinuationBook(
    input: LongImportContinuationAtPathInput
  ): Promise<ImportedContinuationLongBook> {
    const imported = await this.store.importContinuationBook(
      input.parentDirectory,
      {
        sourcePath: input.sourcePath,
        expectedFingerprint: input.expectedFingerprint,
        title: input.title,
        genre: input.genre
      }
    );
    const registered = await this.catalog.openAtPath(imported.projectDirectory);
    return {
      ...imported,
      projectDirectory: registered.projectDirectory,
      book: registered.book,
      summary: registered.summary
    };
  }

  async importPortableBundle(
    parentDirectory: string,
    sourcePath: string
  ): Promise<ImportedPortableLongBook> {
    const imported = await this.store.importPortableBundle(
      parentDirectory,
      sourcePath
    );
    const registered = await this.catalog.openAtPath(imported.projectDirectory);
    return {
      ...imported,
      projectDirectory: registered.projectDirectory,
      book: registered.book,
      summary: registered.summary
    };
  }

  async list(): Promise<LongListBooksResult> {
    return LongListBooksResultSchema.parse(await this.catalog.list());
  }

  async openAtPath(projectDirectory: string): Promise<LongOpenBookResult> {
    return parseOpenResult(await this.catalog.openAtPath(projectDirectory));
  }

  async open(input: LongOpenBookInput): Promise<LongOpenBookResult> {
    const parsed = LongOpenBookInputSchema.parse(input);
    return parseOpenResult(await this.catalog.open(parsed.bookId));
  }

  async updateBindings(
    input: LongUpdateBindingsInput
  ): Promise<LongOpenBookResult> {
    const parsed = LongUpdateBindingsInputSchema.parse(input);
    const opened = await this.openProject({ bookId: parsed.bookId });
    const updated = await this.store.updateBindings(opened.projectDirectory, {
      linkedMaterialIdsByKind: {
        character: [...(parsed.linkedMaterialIdsByKind.character ?? [])],
        gimmick: [...(parsed.linkedMaterialIdsByKind.gimmick ?? [])],
        plot: [...(parsed.linkedMaterialIdsByKind.plot ?? [])],
        draft: [...(parsed.linkedMaterialIdsByKind.draft ?? [])],
        other: [...(parsed.linkedMaterialIdsByKind.other ?? [])]
      },
      linkedSkillIdsByKind: {
        general: [...(parsed.linkedSkillIdsByKind.general ?? [])],
        plot: [...(parsed.linkedSkillIdsByKind.plot ?? [])],
        style: [...(parsed.linkedSkillIdsByKind.style ?? [])],
        other: [...(parsed.linkedSkillIdsByKind.other ?? [])]
      },
      linkedResourceStageScopes: parsed.linkedResourceStageScopes
    });
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      updated.summary,
      "update-bindings"
    );
    return LongOpenBookResultSchema.parse(updated);
  }

  async renameBook(input: LongRenameBookInput): Promise<LongOpenBookResult> {
    const parsed = LongRenameBookInputSchema.parse(input);
    const opened = await this.openProject({ bookId: parsed.bookId });
    const updated = await this.store.renameBook(opened.projectDirectory, {
      title: parsed.title
    });
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      updated.summary,
      "rename-book"
    );
    return LongOpenBookResultSchema.parse(updated);
  }

  async getWorkspaceIndex(
    input: LongOpenBookInput
  ): Promise<LongWorkspaceIndexResult> {
    const opened = await this.openProject(input);
    return LongWorkspaceIndexResultSchema.parse({
      bookId: opened.book.id,
      workspaceIndex: opened.book.workspaceIndex
    });
  }

  async readDocument(
    input: LongReadDocumentInput
  ): Promise<LongReadDocumentResult> {
    const parsed = LongReadDocumentInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const read = await this.store.readDocument(opened.projectDirectory, {
      fileId: parsed.fileId,
      offset: parsed.offset,
      limit: parsed.maxCharacters
    });
    const file = findWorkspaceFile(opened.book.workspaceIndex, read.fileId);
    return LongReadDocumentResultSchema.parse({
      bookId: parsed.bookId,
      file,
      content: read.content,
      offset: read.offset,
      totalCharacters: read.totalCharacters,
      nextOffset: read.nextOffset
    });
  }

  async readAgentsMd(
    input: LongReadAgentsMdInput
  ): Promise<LongReadAgentsMdResult> {
    const parsed = LongReadAgentsMdInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const read = await this.store.readAgentsMd(opened.projectDirectory);
    return LongReadAgentsMdResultSchema.parse({
      bookId: parsed.bookId,
      content: read.content,
      truncated: read.truncated
    });
  }

  async writeAgentsMd(
    input: LongWriteAgentsMdInput
  ): Promise<LongWriteAgentsMdResult> {
    const parsed = LongWriteAgentsMdInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    await this.store.writeAgentsMd(opened.projectDirectory, parsed.content);
    return LongWriteAgentsMdResultSchema.parse({
      bookId: parsed.bookId
    });
  }

  async search(input: LongSearchInput): Promise<LongSearchResult> {
    const parsed = LongSearchInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const query = parsed.query.normalize("NFC");
    const candidates = searchFiles(opened.book.workspaceIndex).filter(
      (candidate) => parsed.scope === "all" || candidate.root === parsed.scope
    );
    const cursorContext: SearchCursorContext = {
      bookId: parsed.bookId,
      query,
      scope: parsed.scope
    };
    const resume = parseSearchCursor(parsed.cursor, cursorContext, candidates);
    if (candidates.length === 0) {
      return LongSearchResultSchema.parse({
        bookId: parsed.bookId,
        query,
        scope: parsed.scope,
        hits: [],
        nextCursor: null
      });
    }
    const searched = await this.store.search(opened.projectDirectory, {
      query,
      fileIds: candidates.map(({ file }) => file.id),
      maxResults: parsed.limit,
      contextCharacters: Math.min(
        500,
        Math.ceil(parsed.maxSnippetCharacters / 2)
      ),
      ...(resume ? { resume } : {})
    });
    const descriptorById = new Map(
      candidates.map((candidate) => [candidate.file.id, candidate])
    );
    const nextCursor = searched.nextResume
      ? formatSearchCursor(searched.nextResume, cursorContext)
      : null;
    return LongSearchResultSchema.parse({
      bookId: parsed.bookId,
      query: searched.query,
      scope: parsed.scope,
      hits: searched.matches.map((match) => {
        const descriptor = descriptorById.get(match.fileId);
        if (!descriptor) {
          throw new Error("长篇搜索返回了未授权文件。");
        }
        return {
          fileId: match.fileId,
          path: match.path,
          root: descriptor.root,
          title: descriptor.title,
          start: match.offset,
          end: match.endOffset,
          snippet: match.preview.slice(0, parsed.maxSnippetCharacters)
        };
      }),
      nextCursor
    });
  }

  async writeDocument(
    input: LongWriteDocumentInput
  ): Promise<LongWriteDocumentResult> {
    const parsed = LongWriteDocumentInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const written = await this.store.writeDocument(opened.projectDirectory, {
      fileId: parsed.fileId,
      content: parsed.content
    });
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      written.summary,
      "write-document"
    );
    const file = findWorkspaceFile(written.book.workspaceIndex, written.fileId);
    return LongWriteDocumentResultSchema.parse({
      bookId: parsed.bookId,
      file,
      summary: LongBookSummarySchema.parse(written.summary)
    });
  }

  async writeChapter(
    input: LongWriteChapterInput
  ): Promise<LongWriteChapterResult> {
    const parsed = LongWriteChapterInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongWriteChapterResultSchema.parse(
      await this.store.writeChapter(opened.projectDirectory, parsed)
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "write-chapter"
    );
    return result;
  }

  async commitChapter(
    input: LongCommitChapterInput
  ): Promise<LongCommitChapterResult> {
    const parsed = LongCommitChapterInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongCommitChapterResultSchema.parse(
      await this.store.commitChapter(opened.projectDirectory, parsed)
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "commit-chapter"
    );
    return result;
  }

  async deleteLedgerCommit(
    input: LongDeleteLedgerCommitInput
  ): Promise<LongDeleteLedgerCommitResult> {
    const parsed = LongDeleteLedgerCommitInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongDeleteLedgerCommitResultSchema.parse(
      await this.store.deleteLedgerCommit(opened.projectDirectory, {
        commitId: parsed.commitId
      })
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "delete-ledger-commit"
    );
    return result;
  }

  async previewOperations(
    input: LongPreviewOperationsInput
  ): Promise<LongPreviewOperationsResult> {
    const parsed = LongPreviewOperationsInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    return LongPreviewOperationsResultSchema.parse({
      bookId: parsed.bookId,
      preview: await this.store.previewWorkspaceOperations(
        opened.projectDirectory,
        parsed.batch
      )
    });
  }

  async applyOperations(
    input: LongApplyOperationsInput
  ): Promise<LongApplyOperationsResult> {
    const parsed = LongApplyOperationsInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const applied = await this.store.applyWorkspaceOperations(
      opened.projectDirectory,
      {
        batch: parsed.batch
      }
    );
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      applied.summary,
      "apply-operations"
    );
    return LongApplyOperationsResultSchema.parse({
      bookId: parsed.bookId,
      operationResult: applied.operationResult,
      summary: applied.summary
    });
  }

  async unregister(input: LongRemoveBookInput): Promise<LongRemoveBookResult> {
    const parsed = LongRemoveBookInputSchema.parse(input);
    return LongRemoveBookResultSchema.parse(
      await this.catalog.unregister(parsed.bookId)
    );
  }

  async delete(input: LongRemoveBookInput): Promise<LongRemoveBookResult> {
    const parsed = LongRemoveBookInputSchema.parse(input);
    return LongRemoveBookResultSchema.parse(
      await this.catalog.delete(parsed.bookId)
    );
  }

  getDiagnostics(): readonly LongWorkspaceServiceDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  private async openProject(input: {
    bookId: string;
  }): Promise<OpenLongProject> {
    return await this.catalog.open(input.bookId);
  }

  private async updateCatalogSummaryBestEffort(
    bookId: string,
    summary: LongBookSummary,
    operation: LongWorkspaceServiceDiagnostic["operation"]
  ): Promise<void> {
    try {
      await this.catalog.updateSummary(bookId, summary);
    } catch (error: unknown) {
      this.recordCatalogDiagnostic(bookId, operation, error);
    }
  }

  private async refreshCatalogSummaryBestEffort(
    projectDirectory: string,
    bookId: string,
    operation: LongWorkspaceServiceDiagnostic["operation"]
  ): Promise<void> {
    try {
      const opened = await this.store.openBook(projectDirectory);
      await this.catalog.updateSummary(opened.book.id, opened.summary);
    } catch (error: unknown) {
      this.recordCatalogDiagnostic(bookId, operation, error);
    }
  }

  private recordCatalogDiagnostic(
    bookId: string,
    operation: LongWorkspaceServiceDiagnostic["operation"],
    error: unknown
  ): void {
    const diagnostic: LongWorkspaceServiceDiagnostic = {
      code: "catalog-summary-cache-update-failed",
      bookId,
      operation,
      message:
        error instanceof Error ? error.message : "长篇项目摘要缓存更新失败。",
      occurredAt: this.now()
    };
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > 100) this.diagnostics.shift();
    try {
      this.onDiagnostic?.({ ...diagnostic });
    } catch {
      // Diagnostics must never turn a completed authoritative store mutation
      // into an operation failure.
    }
  }
}

function parseOpenResult(opened: OpenLongProject): LongOpenBookResult {
  return LongOpenBookResultSchema.parse({
    book: opened.book,
    summary: opened.summary
  });
}

function normalizeCreateInput(
  input: CreateLongBookInput
): StoreCreateLongBookInput {
  return {
    title: input.title,
    genre: input.genre,
    linkedMaterialIdsByKind: {
      character: [...(input.linkedMaterialIdsByKind?.character ?? [])],
      gimmick: [...(input.linkedMaterialIdsByKind?.gimmick ?? [])],
      plot: [...(input.linkedMaterialIdsByKind?.plot ?? [])],
      draft: [...(input.linkedMaterialIdsByKind?.draft ?? [])],
      other: [...(input.linkedMaterialIdsByKind?.other ?? [])]
    },
    linkedSkillIdsByKind: {
      general: [...(input.linkedSkillIdsByKind?.general ?? [])],
      plot: [...(input.linkedSkillIdsByKind?.plot ?? [])],
      style: [...(input.linkedSkillIdsByKind?.style ?? [])],
      other: [...(input.linkedSkillIdsByKind?.other ?? [])]
    }
  };
}

function allWorkspaceFiles(
  index: LongWorkspaceIndexResult["workspaceIndex"]
): LongWorkspaceFileReference[] {
  return [
    index.bookLine,
    ...index.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [category.file]
        : [
            ...(category.overview ? [category.overview] : []),
            ...category.items.map(({ file }) => file)
          ]
    ),
    ...(index.characterOverview ? [index.characterOverview] : []),
    ...index.characterFiles.flatMap((entry) => [
      entry.coreProfile,
      entry.relationships
    ]),
    ...index.chapters.flatMap((entry) => [
      entry.body,
      entry.card,
      entry.characterState,
      entry.handoff,
      entry.foreshadowingChanges,
      ...(entry.worldReveals ? [entry.worldReveals] : []),
      ...entry.characterContinuity.flatMap((continuity) => [
        continuity.currentState,
        continuity.history
      ])
    ]),
    ...index.plot.storyPlots.map(({ file }) => file),
    ...index.ledger.commits.map(({ recordFile }) => recordFile)
  ];
}

function findWorkspaceFile(
  index: LongWorkspaceIndexResult["workspaceIndex"],
  fileId: string
): LongWorkspaceFileReference {
  const file = allWorkspaceFiles(index).find(
    (candidate) => candidate.id === fileId
  );
  if (!file) throw new Error(`长篇文件不存在：${fileId}`);
  return file;
}

function searchFiles(
  index: LongWorkspaceIndexResult["workspaceIndex"]
): IndexedSearchFile[] {
  const characterById = new Map(
    index.characters.map((character) => [character.id, character])
  );
  const chapterById = new Map(
    index.plot.chapterCards.map((chapter) => [chapter.id, chapter])
  );
  return [
    {
      file: index.bookLine,
      root: "plot_design",
      title: "全书主线"
    },
    ...index.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [
            {
              file: category.file,
              root: "worldbuilding" as const,
              title: category.title
            }
          ]
        : [
            ...(category.overview
              ? [
                  {
                    file: category.overview,
                    root: "worldbuilding" as const,
                    title: `${category.title} / 概览`
                  }
                ]
              : []),
            ...category.items.map((item) => ({
              file: item.file,
              root: "worldbuilding" as const,
              title: `${category.title} / ${item.title}`
            }))
          ]
    ),
    ...(index.characterOverview
      ? [
          {
            file: index.characterOverview,
            root: "character_design" as const,
            title: "人物概览"
          }
        ]
      : []),
    ...index.characterFiles.flatMap((entry) => {
      const title =
        characterById.get(entry.characterId)?.name ?? entry.characterId;
      return [
        {
          file: entry.coreProfile,
          root: "character_design" as const,
          title: `${title} · 核心档案`
        },
        {
          file: entry.relationships,
          root: "character_design" as const,
          title: `${title} · 人物关系`
        }
      ];
    }),
    ...index.chapters.flatMap((entry) => {
      const title =
        chapterById.get(entry.chapterCardId)?.title ?? entry.chapterCardId;
      return [
        {
          file: entry.body,
          root: "draft" as const,
          title: `${title} · 正文`
        },
        {
          file: entry.card,
          root: "plot_design" as const,
          title: `${title} · 章卡`
        },
        {
          file: entry.characterState,
          root: "draft" as const,
          title: `${title} · 人物状态`
        },
        {
          file: entry.handoff,
          root: "draft" as const,
          title: `${title} · 交接`
        },
        {
          file: entry.foreshadowingChanges,
          root: "continuity_ledger" as const,
          title: `${title} · 伏笔变化`
        },
        ...(entry.worldReveals
          ? [
              {
                file: entry.worldReveals,
                root: "continuity_ledger" as const,
                title: `${title} · 世界观揭露`
              }
            ]
          : []),
        ...entry.characterContinuity.flatMap((continuity) => {
          const characterTitle =
            characterById.get(continuity.characterId)?.name ??
            continuity.characterId;
          return [
            {
              file: continuity.currentState,
              root: "continuity_ledger" as const,
              title: `${title} · ${characterTitle} · 当前状态`
            },
            {
              file: continuity.history,
              root: "continuity_ledger" as const,
              title: `${title} · ${characterTitle} · 历史轨迹`
            }
          ];
        })
      ];
    }),
    ...index.plot.storyPlots.map((entry) => ({
      file: entry.file,
      root: "plot_design" as const,
      title: entry.title
    })),
    ...index.ledger.commits.map((commit) => ({
      file: commit.recordFile,
      root: "continuity_ledger" as const,
      title: `提交 ${commit.sequence} · ${commit.chapterCardId}`
    }))
  ];
}

interface SearchCursorContext {
  bookId: string;
  query: string;
  scope: LongSearchInput["scope"];
}

interface SearchCursorPayload extends LongProjectSearchResume {
  v: 1;
  bookId: string;
  querySha256: string;
  scope: LongSearchInput["scope"];
}

const SEARCH_CURSOR_KEYS = new Set([
  "v",
  "bookId",
  "querySha256",
  "scope",
  "fileIndex",
  "fileId",
  "characterOffset"
]);

function querySha256(query: string): string {
  return createHash("sha256").update(query, "utf8").digest("hex");
}

function invalidSearchCursor(): never {
  throw new Error("长篇搜索游标无效或已失效，请重新搜索。");
}

function parseSearchCursor(
  value: string | undefined,
  context: SearchCursorContext,
  candidates: readonly IndexedSearchFile[]
): LongProjectSearchResume | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith("v1.")) invalidSearchCursor();
  const token = value.slice(3);
  if (!token || !/^[A-Za-z0-9_-]+$/u.test(token)) invalidSearchCursor();
  let payload: unknown;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) invalidSearchCursor();
    payload = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    invalidSearchCursor();
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    invalidSearchCursor();
  }
  const cursor = payload as Record<string, unknown>;
  if (
    Object.keys(cursor).length !== SEARCH_CURSOR_KEYS.size ||
    Object.keys(cursor).some((key) => !SEARCH_CURSOR_KEYS.has(key)) ||
    cursor.v !== 1 ||
    typeof cursor.bookId !== "string" ||
    typeof cursor.querySha256 !== "string" ||
    typeof cursor.scope !== "string" ||
    typeof cursor.fileIndex !== "number" ||
    typeof cursor.fileId !== "string" ||
    typeof cursor.characterOffset !== "number"
  ) {
    invalidSearchCursor();
  }
  const parsed = cursor as unknown as SearchCursorPayload;
  if (
    parsed.bookId !== context.bookId ||
    parsed.querySha256 !== querySha256(context.query) ||
    parsed.scope !== context.scope ||
    !Number.isSafeInteger(parsed.fileIndex) ||
    parsed.fileIndex < 0 ||
    !Number.isSafeInteger(parsed.characterOffset) ||
    parsed.characterOffset < 0 ||
    candidates[parsed.fileIndex]?.file.id !== parsed.fileId
  ) {
    invalidSearchCursor();
  }
  return {
    fileIndex: parsed.fileIndex,
    fileId: parsed.fileId,
    characterOffset: parsed.characterOffset
  };
}

function formatSearchCursor(
  resume: LongProjectSearchResume,
  context: SearchCursorContext
): string {
  const payload: SearchCursorPayload = {
    v: 1,
    bookId: context.bookId,
    querySha256: querySha256(context.query),
    scope: context.scope,
    fileIndex: resume.fileIndex,
    fileId: resume.fileId,
    characterOffset: resume.characterOffset
  };
  const cursor = `v1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  if (cursor.length > 2_048) {
    throw new Error("长篇搜索游标超过安全长度。");
  }
  return cursor;
}
