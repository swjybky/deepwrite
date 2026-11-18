import { z } from "zod";
import {
  CatalogIdSchema,
  CatalogTitleSchema,
  TimestampSchema
} from "../catalog/kinds";
import { DocumentVersionOriginSchema } from "../document-version-origin";
import { EnvelopeBaseSchema } from "../envelope";
import {
  MYSTERY_AGENTS_MD_MAX_CHARACTERS,
  MYSTERY_DOCUMENT_MAX_CHARACTERS,
  MysteryBoardSpecSchema,
  MysteryBookGenreSchema,
  MysteryBookIdSchema,
  MysteryBookManifestSchema,
  MysteryBookSummarySchema,
  MysteryDocumentTargetSchema,
  MysteryProjectDiagnosticSchema,
  MysteryRevisionSchema,
  MysteryWorkspaceIndexSnapshotSchema
} from "./manifest";
import {
  MysteryApplyOperationsInputSchema,
  MysteryExportBundleInputSchema,
  MysteryOperationBatchSchema,
  MysterySearchInputSchema
} from "./operations";

const UniqueLibraryIdListSchema = z
  .array(CatalogIdSchema)
  .max(1_000)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Linked library ids cannot contain duplicates."
  });

export const CreateMysteryBookInputSchema = z
  .object({
    title: CatalogTitleSchema,
    genre: MysteryBookGenreSchema,
    boardSpec: MysteryBoardSpecSchema.partial().optional(),
    linkedMaterialIds: UniqueLibraryIdListSchema.optional(),
    linkedSkillIds: UniqueLibraryIdListSchema.optional()
  })
  .strict();
export type CreateMysteryBookInput = z.infer<
  typeof CreateMysteryBookInputSchema
>;

export const CreateMysteryBookAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    input: CreateMysteryBookInputSchema
  })
  .strict();
export type CreateMysteryBookAtPathInput = z.infer<
  typeof CreateMysteryBookAtPathInputSchema
>;

export const MysteryOpenBookInputSchema = z
  .object({ bookId: MysteryBookIdSchema })
  .strict();
export type MysteryOpenBookInput = z.infer<typeof MysteryOpenBookInputSchema>;

export const MysteryOpenBookAtPathInputSchema = z
  .object({ projectDirectory: z.string().trim().min(1) })
  .strict();
export type MysteryOpenBookAtPathInput = z.infer<
  typeof MysteryOpenBookAtPathInputSchema
>;

export const MysteryRenameBookInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    title: CatalogTitleSchema
  })
  .strict();
export type MysteryRenameBookInput = z.infer<
  typeof MysteryRenameBookInputSchema
>;

export const MysteryUpdateBindingsInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    linkedMaterialIds: UniqueLibraryIdListSchema,
    linkedSkillIds: UniqueLibraryIdListSchema
  })
  .strict();
export type MysteryUpdateBindingsInput = z.infer<
  typeof MysteryUpdateBindingsInputSchema
>;

export const MysteryDuplicateBookInputSchema = z
  .object({ bookId: MysteryBookIdSchema })
  .strict();
export type MysteryDuplicateBookInput = z.infer<
  typeof MysteryDuplicateBookInputSchema
>;

export const MysteryRemoveBookInputSchema = z
  .object({ bookId: MysteryBookIdSchema })
  .strict();
export type MysteryRemoveBookInput = z.infer<
  typeof MysteryRemoveBookInputSchema
>;

export const MysteryRemoveBookResultSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    removed: z.literal(true)
  })
  .strict();
export type MysteryRemoveBookResult = z.infer<
  typeof MysteryRemoveBookResultSchema
>;

export const MysteryListBooksResultSchema = z
  .object({
    books: z.array(MysteryBookSummarySchema),
    diagnostics: z.array(MysteryProjectDiagnosticSchema).optional()
  })
  .strict();
export type MysteryListBooksResult = z.infer<
  typeof MysteryListBooksResultSchema
>;

export const MysteryOpenBookResultSchema = z
  .object({
    book: MysteryBookManifestSchema,
    summary: MysteryBookSummarySchema,
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema,
    projectDirectory: z.string().min(1)
  })
  .strict();
export type MysteryOpenBookResult = z.infer<typeof MysteryOpenBookResultSchema>;

export const MysteryWorkspaceIndexResultSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema
  })
  .strict();
export type MysteryWorkspaceIndexResult = z.infer<
  typeof MysteryWorkspaceIndexResultSchema
>;

export const MysteryReadDocumentInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    target: MysteryDocumentTargetSchema,
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(200_000).optional()
  })
  .strict();
export type MysteryReadDocumentInput = z.infer<
  typeof MysteryReadDocumentInputSchema
>;

export const MysteryReadDocumentResultSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    target: MysteryDocumentTargetSchema,
    content: z.string(),
    totalCharacters: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    revision: MysteryRevisionSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MysteryReadDocumentResult = z.infer<
  typeof MysteryReadDocumentResultSchema
>;

export const MysteryWriteDocumentInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    target: MysteryDocumentTargetSchema,
    content: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS),
    expectedRevision: MysteryRevisionSchema.optional(),
    versionOrigin: DocumentVersionOriginSchema.optional()
  })
  .strict();
export type MysteryWriteDocumentInput = z.infer<
  typeof MysteryWriteDocumentInputSchema
>;

export const MysteryReadAgentsMdInputSchema = z
  .object({ bookId: MysteryBookIdSchema })
  .strict();
export type MysteryReadAgentsMdInput = z.infer<
  typeof MysteryReadAgentsMdInputSchema
>;

export const MysteryReadAgentsMdResultSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    content: z.string(),
    revision: MysteryRevisionSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MysteryReadAgentsMdResult = z.infer<
  typeof MysteryReadAgentsMdResultSchema
>;

export const MysteryWriteAgentsMdInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    content: z.string().max(MYSTERY_AGENTS_MD_MAX_CHARACTERS),
    expectedRevision: MysteryRevisionSchema.optional()
  })
  .strict();
export type MysteryWriteAgentsMdInput = z.infer<
  typeof MysteryWriteAgentsMdInputSchema
>;

export const MysteryWriteAgentsMdResultSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    content: z.string(),
    revision: MysteryRevisionSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MysteryWriteAgentsMdResult = z.infer<
  typeof MysteryWriteAgentsMdResultSchema
>;

export const MysteryPreviewOperationsInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    batch: MysteryOperationBatchSchema
  })
  .strict();
export type MysteryPreviewOperationsInput = z.infer<
  typeof MysteryPreviewOperationsInputSchema
>;

export const MysteryRestoreOperationsInputSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    restoreId: CatalogIdSchema
  })
  .strict();
export type MysteryRestoreOperationsInput = z.infer<
  typeof MysteryRestoreOperationsInputSchema
>;

export const MysteryCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.list"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.createBook"),
    payload: CreateMysteryBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.createBookAtPath"),
    payload: CreateMysteryBookAtPathInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.open"),
    payload: MysteryOpenBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.openAtPath"),
    payload: MysteryOpenBookAtPathInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.openExisting"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.duplicateBook"),
    payload: MysteryDuplicateBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.rename"),
    payload: MysteryRenameBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.updateBindings"),
    payload: MysteryUpdateBindingsInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.getWorkspaceIndex"),
    payload: MysteryOpenBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.readDocument"),
    payload: MysteryReadDocumentInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.writeDocument"),
    payload: MysteryWriteDocumentInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.readAgentsMd"),
    payload: MysteryReadAgentsMdInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.writeAgentsMd"),
    payload: MysteryWriteAgentsMdInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.search"),
    payload: MysterySearchInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.previewOperations"),
    payload: MysteryPreviewOperationsInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.applyOperations"),
    payload: MysteryApplyOperationsInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.restoreOperations"),
    payload: MysteryRestoreOperationsInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.unregister"),
    payload: MysteryRemoveBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.delete"),
    payload: MysteryRemoveBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.exportBundle"),
    payload: MysteryExportBundleInputSchema
  })
] as const;
