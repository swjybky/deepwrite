import { z } from "zod";
import {
  LinkedMaterialIdsByKindInputSchema,
  LinkedSkillIdsByKindInputSchema
} from "./catalog";
import {
  LongWorkspaceImpactPreviewSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationResultSchema
} from "./long-workspace-operations";
import {
  LongBookIdSchema,
  LongBookSchema,
  LongBookMetadataSchema,
  LongBookSummarySchema,
  LongLinkedResourceStageScopesSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongProjectRelativePathSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceRootSchema,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  longAgentsMdCharacterCount
} from "./long-workspace";
import {
  LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS,
  LONG_DOCUMENT_PAGE_MAX_CHARACTERS
} from "./long-workspace-limits";
import { LongBookGenreSchema } from "./long-book-genres";
import { LongRestorePointSchema } from "./long-workspace-restore";
export * from "./long-workspace-limits";
export * from "./long-book-genres";
export * from "./long-workspace-runtime/worldbuilding";
export * from "./long-workspace-runtime/character";
export * from "./long-workspace-runtime/plot";
export * from "./long-workspace-runtime/context";

const MAX_LONG_BINDING_IDS_PER_KIND = 1_000;

const LongLinkedMaterialIdsByKindInputSchema =
  LinkedMaterialIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

const LongLinkedSkillIdsByKindInputSchema =
  LinkedSkillIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

export const CreateLongBookInputSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema,
    linkedMaterialIdsByKind: LongLinkedMaterialIdsByKindInputSchema.optional(),
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema.optional()
  })
  .strict();
export type CreateLongBookInput = z.infer<typeof CreateLongBookInputSchema>;

export const LongDuplicateBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongDuplicateBookInput = z.infer<
  typeof LongDuplicateBookInputSchema
>;

export const CreateLongBookAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    input: CreateLongBookInputSchema
  })
  .strict();
export type CreateLongBookAtPathInput = z.infer<
  typeof CreateLongBookAtPathInputSchema
>;

export const LongImportWriteClawAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportWriteClawAtPathInput = z.infer<
  typeof LongImportWriteClawAtPathInputSchema
>;

export const LongImportWriteClawResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    sourceKind: z.enum(["write-claw-zip", "long-workspace-json", "book-json"]),
    legacySchemaVersion: z.number().int().nonnegative(),
    committedChapterPolicy: z.enum([
      "written-uncommitted",
      "legacy-checkpoints"
    ]),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message: "Imported long book and summary must share the same id."
      });
    }
  });
export type LongImportWriteClawResult = z.infer<
  typeof LongImportWriteClawResultSchema
>;

export const LongLegacySyncModuleSchema = z.enum([
  "worldbuilding",
  "characters",
  "plot"
]);
export type LongLegacySyncModule = z.infer<typeof LongLegacySyncModuleSchema>;

export const LongLegacySyncCountsSchema = z
  .object({
    worldbuilding: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    outline: z.number().int().nonnegative().max(1),
    volumes: z.number().int().nonnegative(),
    plotPoints: z.number().int().nonnegative(),
    storyEvents: z.number().int().nonnegative(),
    chapterCards: z.number().int().nonnegative()
  })
  .strict();
export type LongLegacySyncCounts = z.infer<typeof LongLegacySyncCountsSchema>;

const LongLegacySyncPreviewBaseSchema = z
  .object({
    sourceTitle: z.string().trim().min(1).max(256),
    sourceKind: z.enum(["write-claw-zip", "long-workspace-json", "book-json"]),
    legacySchemaVersion: z.number().int().nonnegative(),
    counts: LongLegacySyncCountsSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict();

export const LongChooseLegacySyncSourceResultSchema =
  LongLegacySyncPreviewBaseSchema.extend({
    previewId: z.string().trim().min(1).max(256),
    expiresAt: z.string().datetime()
  }).strict();
export type LongChooseLegacySyncSourceResult = z.infer<
  typeof LongChooseLegacySyncSourceResultSchema
>;

export const LongPreviewLegacySyncAtPathInputSchema = z
  .object({ sourcePath: z.string().trim().min(1) })
  .strict();
export const LongPreviewLegacySyncAtPathResultSchema =
  LongLegacySyncPreviewBaseSchema.extend({
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();
export type LongPreviewLegacySyncAtPathResult = z.infer<
  typeof LongPreviewLegacySyncAtPathResultSchema
>;

export const LongApplyLegacySyncInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    previewId: z.string().trim().min(1).max(256),
    modules: z.array(LongLegacySyncModuleSchema).min(1).max(3)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.modules).size !== value.modules.length) {
      context.addIssue({
        code: "custom",
        path: ["modules"],
        message: "Legacy sync modules must be unique."
      });
    }
  });
export type LongApplyLegacySyncInput = z.infer<
  typeof LongApplyLegacySyncInputSchema
>;

export const LongApplyLegacySyncAtPathInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    modules: z.array(LongLegacySyncModuleSchema).min(1).max(3),
    sourcePath: z.string().trim().min(1),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.modules).size !== value.modules.length) {
      context.addIssue({
        code: "custom",
        path: ["modules"],
        message: "Legacy sync modules must be unique."
      });
    }
  });
export type LongApplyLegacySyncAtPathInput = z.infer<
  typeof LongApplyLegacySyncAtPathInputSchema
>;

export const LongApplyLegacySyncResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    summary: LongBookSummarySchema,
    imported: LongLegacySyncCountsSchema,
    skipped: LongLegacySyncCountsSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict();
export type LongApplyLegacySyncResult = z.infer<
  typeof LongApplyLegacySyncResultSchema
>;

export const LongImportPortableAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportPortableAtPathInput = z.infer<
  typeof LongImportPortableAtPathInputSchema
>;

export const LongImportPortableResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    exportedAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message:
          "Imported portable long book and summary must share the same id."
      });
    }
  });
export type LongImportPortableResult = z.infer<
  typeof LongImportPortableResultSchema
>;

export const LongContinuationImportEncodingSchema = z.enum([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "gb18030"
]);
export type LongContinuationImportEncoding = z.infer<
  typeof LongContinuationImportEncodingSchema
>;

export const LongContinuationImportChapterPreviewSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(1_024),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    byteLength: z.number().int().positive(),
    encoding: LongContinuationImportEncodingSchema
  })
  .strict();
export type LongContinuationImportChapterPreview = z.infer<
  typeof LongContinuationImportChapterPreviewSchema
>;

export const LongContinuationImportVolumePreviewSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(1_024),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    chapters: z
      .array(LongContinuationImportChapterPreviewSchema)
      .min(1)
      .max(100_000)
  })
  .strict();
export type LongContinuationImportVolumePreview = z.infer<
  typeof LongContinuationImportVolumePreviewSchema
>;

export const LongContinuationImportScanSchema = z
  .object({
    defaultTitle: z.string().trim().min(1).max(256),
    mode: z.enum(["flat", "volume_folders"]),
    volumeCount: z.number().int().positive(),
    chapterCount: z.number().int().positive(),
    checkpointCount: z.number().int().nonnegative(),
    pendingVolumeTitle: z.string().trim().min(1).max(256),
    pendingChapterTitle: z.string().trim().min(1).max(256),
    volumes: z
      .array(LongContinuationImportVolumePreviewSchema)
      .min(1)
      .max(10_000),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    const chapterCount = value.volumes.reduce(
      (total, volume) => total + volume.chapters.length,
      0
    );
    if (
      value.volumeCount !== value.volumes.length ||
      value.chapterCount !== chapterCount ||
      value.checkpointCount !== Math.max(0, chapterCount - 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapterCount"],
        message: "Continuation import preview counts must match its volumes."
      });
    }
    const pendingVolume = value.volumes.at(-1);
    const pendingChapter = pendingVolume?.chapters.at(-1);
    if (
      pendingVolume?.title !== value.pendingVolumeTitle ||
      pendingChapter?.title !== value.pendingChapterTitle
    ) {
      context.addIssue({
        code: "custom",
        path: ["pendingChapterTitle"],
        message:
          "Continuation import pending chapter must be the final ordered chapter."
      });
    }
  });
export type LongContinuationImportScan = z.infer<
  typeof LongContinuationImportScanSchema
>;

export const LongChooseContinuationImportSourceResultSchema =
  LongContinuationImportScanSchema.extend({
    previewId: z.string().trim().min(1).max(256),
    expiresAt: z.string().datetime()
  }).strict();
export type LongChooseContinuationImportSourceResult = z.infer<
  typeof LongChooseContinuationImportSourceResultSchema
>;

export const LongPreviewContinuationImportAtPathInputSchema = z
  .object({ sourcePath: z.string().trim().min(1) })
  .strict();
export type LongPreviewContinuationImportAtPathInput = z.infer<
  typeof LongPreviewContinuationImportAtPathInputSchema
>;

export const LongPreviewContinuationImportAtPathResultSchema =
  LongContinuationImportScanSchema.extend({
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();
export type LongPreviewContinuationImportAtPathResult = z.infer<
  typeof LongPreviewContinuationImportAtPathResultSchema
>;

export const LongImportContinuationInputSchema = z
  .object({
    previewId: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema
  })
  .strict();
export type LongImportContinuationInput = z.infer<
  typeof LongImportContinuationInputSchema
>;

export const LongImportContinuationAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema
  })
  .strict();
export type LongImportContinuationAtPathInput = z.infer<
  typeof LongImportContinuationAtPathInputSchema
>;

export const LongImportContinuationResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    importedVolumeCount: z.number().int().positive(),
    importedChapterCount: z.number().int().positive(),
    checkpointCount: z.number().int().nonnegative(),
    pendingChapterCardId: LongChapterCardIdSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message:
          "Imported continuation book and summary must share the same id."
      });
    }
    if (value.checkpointCount !== Math.max(0, value.importedChapterCount - 1)) {
      context.addIssue({
        code: "custom",
        path: ["checkpointCount"],
        message:
          "Continuation checkpoint count must leave exactly one pending chapter."
      });
    }
  });
export type LongImportContinuationResult = z.infer<
  typeof LongImportContinuationResultSchema
>;

export const LongOpenBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongOpenBookInput = z.infer<typeof LongOpenBookInputSchema>;

export const LongRenameBookInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().trim().min(1).max(256)
  })
  .strict();
export type LongRenameBookInput = z.infer<typeof LongRenameBookInputSchema>;

export const LongUpdateBindingsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    linkedMaterialIdsByKind: LongLinkedMaterialIdsByKindInputSchema,
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema,
    linkedResourceStageScopes: LongLinkedResourceStageScopesSchema.optional()
  })
  .strict();
export type LongUpdateBindingsInput = z.infer<
  typeof LongUpdateBindingsInputSchema
>;

export const LongListBooksResultSchema = z
  .object({
    updatedAt: z.string().datetime(),
    books: z.array(LongBookSummarySchema).max(100_000),
    diagnostics: z
      .array(
        z
          .object({
            bookId: LongBookIdSchema,
            code: z.enum(["unavailable", "invalid"]),
            message: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(100_000)
      .optional()
  })
  .strict();
export type LongListBooksResult = z.infer<typeof LongListBooksResultSchema>;

export const LongOpenBookAtPathInputSchema = z
  .object({
    projectDirectory: z.string().trim().min(1)
  })
  .strict();
export type LongOpenBookAtPathInput = z.infer<
  typeof LongOpenBookAtPathInputSchema
>;

export const LongRemoveBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongRemoveBookInput = z.infer<typeof LongRemoveBookInputSchema>;

export const LongRemoveBookResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    removed: z.boolean()
  })
  .strict();
export type LongRemoveBookResult = z.infer<typeof LongRemoveBookResultSchema>;

export const LongOpenBookResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongOpenBookResult = z.infer<typeof LongOpenBookResultSchema>;

export const LongReadDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    offset: z.number().int().nonnegative().default(0),
    maxCharacters: z
      .number()
      .int()
      .min(1)
      .max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS)
      .default(LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
  })
  .strict();
export type LongReadDocumentInput = z.infer<typeof LongReadDocumentInputSchema>;

export const LongReadDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    // JavaScript string length counts UTF-16 code units. Reserve two units
    // per requested Unicode code point, then enforce the actual page limit
    // below with Array.from.
    content: z.string().max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS * 2),
    offset: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    nextOffset: z.number().int().positive().nullable()
  })
  .strict()
  .superRefine((value, context) => {
    // Document paging is defined in Unicode code points so an emoji or other
    // surrogate pair is never split between pages.
    const pageCharacters = Array.from(value.content).length;
    if (pageCharacters > LONG_DOCUMENT_PAGE_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds the maximum character count."
      });
    }
    const endOffset = value.offset + pageCharacters;
    if (endOffset > value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds its declared total length."
      });
    }
    if (
      value.nextOffset !== null &&
      (value.nextOffset !== endOffset ||
        value.nextOffset >= value.totalCharacters)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message:
          "Long document next offset must follow the page and leave unread content."
      });
    }
    if (value.nextOffset === null && endOffset < value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message: "A truncated long document page must expose its next offset."
      });
    }
  });
export type LongReadDocumentResult = z.infer<
  typeof LongReadDocumentResultSchema
>;

export const LONG_SEARCH_SCOPES = [
  "all",
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongSearchScopeSchema = z.enum(LONG_SEARCH_SCOPES);
export type LongSearchScope = z.infer<typeof LongSearchScopeSchema>;

export const LongSearchInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().trim().min(1).max(256),
    scope: LongSearchScopeSchema.default("all"),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    maxSnippetCharacters: z.number().int().min(40).max(2_000).default(320)
  })
  .strict();
export type LongSearchInput = z.infer<typeof LongSearchInputSchema>;

export const LongSearchHitSchema = z
  .object({
    fileId: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    root: LongWorkspaceRootSchema,
    title: z.string().trim().min(1).max(512),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    snippet: z.string().max(2_000)
  })
  .strict()
  .refine((hit) => hit.end > hit.start, {
    path: ["end"],
    message: "Long search hit end must be after start."
  });
export type LongSearchHit = z.infer<typeof LongSearchHitSchema>;

export const LongSearchResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().min(1).max(256),
    scope: LongSearchScopeSchema,
    hits: z.array(LongSearchHitSchema).max(100),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict();
export type LongSearchResult = z.infer<typeof LongSearchResultSchema>;

export const LongWriteDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    content: z.string().max(16 * 1024 * 1024),
    /** Refuses the write if the file changed after this index timestamp. */
    expectedUpdatedAt: z.string().datetime().optional()
  })
  .strict();
export type LongWriteDocumentInput = z.infer<
  typeof LongWriteDocumentInputSchema
>;

export const LongWriteDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongWriteDocumentResult = z.infer<
  typeof LongWriteDocumentResultSchema
>;

function refineLongAgentsMdContent(
  content: string,
  context: z.RefinementCtx,
  path: Array<string | number> = ["content"]
): void {
  if (longAgentsMdCharacterCount(content) > LONG_AGENTS_MD_MAX_CHARACTERS) {
    context.addIssue({
      code: "custom",
      path,
      message: "Long AGENTS.md exceeds the maximum character count."
    });
  }
}

export const LongReadAgentsMdInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongReadAgentsMdInput = z.infer<typeof LongReadAgentsMdInputSchema>;

export const LongReadAgentsMdResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    content: z.string().max(LONG_AGENTS_MD_MAX_CHARACTERS * 2),
    truncated: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    refineLongAgentsMdContent(value.content, context);
  });
export type LongReadAgentsMdResult = z.infer<
  typeof LongReadAgentsMdResultSchema
>;

export const LongWriteAgentsMdInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    content: z.string().max(LONG_AGENTS_MD_MAX_CHARACTERS * 2)
  })
  .strict()
  .superRefine((value, context) => {
    refineLongAgentsMdContent(value.content, context);
  });
export type LongWriteAgentsMdInput = z.infer<
  typeof LongWriteAgentsMdInputSchema
>;

export const LongWriteAgentsMdResultSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongWriteAgentsMdResult = z.infer<
  typeof LongWriteAgentsMdResultSchema
>;

export const LongWorkspaceIndexResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    workspaceIndex: LongWorkspaceIndexSnapshotSchema,
    /** Metadata has no navigation tree; clients derive it from the index. */
    metadata: LongBookMetadataSchema.optional()
  })
  .strict();
export type LongWorkspaceIndexResult = z.infer<
  typeof LongWorkspaceIndexResultSchema
>;

export const LongPreviewOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema
  })
  .strict();
export type LongPreviewOperationsInput = z.infer<
  typeof LongPreviewOperationsInputSchema
>;

export const LongPreviewOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    preview: LongWorkspaceImpactPreviewSchema
  })
  .strict();
export type LongPreviewOperationsResult = z.infer<
  typeof LongPreviewOperationsResultSchema
>;

export const LongApplyOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema,
    /** Keep an undo snapshot when the batch deletes or rewrites records. */
    captureRestorePoint: z.boolean().optional()
  })
  .strict();
export type LongApplyOperationsInput = z.infer<
  typeof LongApplyOperationsInputSchema
>;

export const LongApplyOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    operationResult: LongWorkspaceOperationResultSchema,
    summary: LongBookSummarySchema,
    restorePoint: LongRestorePointSchema.optional()
  })
  .strict();
export type LongApplyOperationsResult = z.infer<
  typeof LongApplyOperationsResultSchema
>;
