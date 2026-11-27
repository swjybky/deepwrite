import { z } from "zod";
import { CatalogIndexAcademicBookSchema } from "../academic-book";

import { DraftSectionIdSchema, DraftSectionTitleSchema } from "../expert-draft";
import {
  BookSchema,
  CurrentScriptBookSchema,
  CurrentShortBookSchema
} from "./books";
import {
  CATALOG_DRAFT_DIRECTORY_ID,
  CatalogIdSchema,
  CatalogProjectKindSchema,
  CatalogTitleSchema,
  TimestampSchema,
  uniqueIds
} from "./kinds";
import {
  MaterialEntrySchema,
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  SkillEntrySchema,
  SkillLibraryGroupSchema,
  SkillLibrarySchema
} from "./libraries";
import {
  CreativePlotStagesSchema,
  DEFAULT_CREATIVE_PLOT_STAGES,
  type CreativePlotStage
} from "./plot-stages";
import { LibraryOrganizationSchema } from "../library-organization";

export const CatalogLegacyImportSchema = z.object({
  sourceRoot: CatalogIdSchema,
  sourceRoots: z.array(CatalogIdSchema).min(1).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: TimestampSchema,
  materials: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  materialGroups: z.number().int().nonnegative(),
  skillGroups: z.number().int().nonnegative()
});
export type CatalogLegacyImport = z.infer<typeof CatalogLegacyImportSchema>;

export const CatalogProjectDiagnosticSchema = z.object({
  projectId: CatalogIdSchema,
  kind: CatalogProjectKindSchema,
  code: z.enum(["unavailable", "invalid"]),
  message: z.string().trim().min(1)
});
export type CatalogProjectDiagnostic = z.infer<
  typeof CatalogProjectDiagnosticSchema
>;

export const CatalogDraftRecoveryEntrySchema = z.object({
  title: z.string(),
  content: z.string(),
  dirty: z.literal(true),
  recoveryUpdatedAt: TimestampSchema.optional(),
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional()
});
export type CatalogDraftRecoveryEntry = z.infer<
  typeof CatalogDraftRecoveryEntrySchema
>;
export const CatalogDraftRecoveryKeySchema = z.string().min(1).max(32_768);
export const CatalogDraftRecoverySchema = z.record(
  CatalogDraftRecoveryKeySchema,
  CatalogDraftRecoveryEntrySchema
);
export type CatalogDraftRecovery = z.infer<typeof CatalogDraftRecoverySchema>;
export const CatalogDraftRecoverySaveResultSchema = z.object({
  saved: z.literal(true)
});
export type CatalogDraftRecoverySaveResult = z.infer<
  typeof CatalogDraftRecoverySaveResultSchema
>;

function migrateCatalogSnapshotCreativePlotStages(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    Array.isArray(record.creativePlotStages) &&
    record.creativePlotStages.length > 0
  ) {
    return value;
  }
  const books = Array.isArray(record.books) ? record.books : [];
  const definitions = new Map<string, CreativePlotStage>();
  for (const stage of DEFAULT_CREATIVE_PLOT_STAGES) {
    definitions.set(stage.id, { ...stage });
  }
  for (const book of books) {
    if (!book || typeof book !== "object") continue;
    const plotStages = (book as { plotStages?: unknown }).plotStages;
    if (!Array.isArray(plotStages)) continue;
    for (const stage of plotStages) {
      if (!stage || typeof stage !== "object") continue;
      const candidate = stage as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
      };
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.description !== "string"
      ) {
        continue;
      }
      if (!definitions.has(candidate.id)) {
        definitions.set(candidate.id, {
          id: candidate.id,
          title: candidate.title,
          description: candidate.description
        });
      }
    }
  }
  return {
    ...record,
    creativePlotStages: [...definitions.values()]
  };
}

export const CatalogSnapshotSchema = z
  .preprocess(
    migrateCatalogSnapshotCreativePlotStages,
    z.object({
      schemaVersion: z.literal(1),
      revision: z.number().int().nonnegative(),
      libraryOrganization: LibraryOrganizationSchema.optional(),
      creativePlotStages: CreativePlotStagesSchema,
      books: z.array(BookSchema),
      materials: z.array(MaterialLibrarySchema),
      materialGroups: z.array(MaterialLibraryGroupSchema),
      skills: z.array(SkillLibrarySchema),
      skillGroups: z.array(SkillLibraryGroupSchema),
      updatedAt: TimestampSchema,
      legacyImport: CatalogLegacyImportSchema.optional(),
      projectDiagnostics: z.array(CatalogProjectDiagnosticSchema).optional()
    })
  )
  .superRefine((snapshot, context) => {
    const collections: Array<[string, ReadonlyArray<{ id: string }>]> = [
      ["books", snapshot.books],
      ["materials", snapshot.materials],
      ["materialGroups", snapshot.materialGroups],
      ["skills", snapshot.skills],
      ["skillGroups", snapshot.skillGroups]
    ];
    for (const [name, values] of collections) {
      if (!uniqueIds(values.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `${name} cannot contain duplicate ids.`
        });
      }
    }
    const globalIds = new Set(
      snapshot.creativePlotStages.map((stage) => stage.id)
    );
    for (const [bookIndex, book] of snapshot.books.entries()) {
      if (!uniqueIds(book.documents.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: ["books", bookIndex, "documents"],
          message: "Book documents cannot contain duplicate ids."
        });
      }
      if (book.bookType === "academic") continue;
      for (const [stageIndex, stage] of book.plotStages.entries()) {
        if (!globalIds.has(stage.id)) {
          context.addIssue({
            code: "custom",
            path: ["books", bookIndex, "plotStages", stageIndex, "id"],
            message: `Book plot stage ${stage.id} must exist in creativePlotStages.`
          });
        }
      }
    }
  });
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

export const CatalogContentBytesSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const CatalogContentStampSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^(?:fs|manifest)-v1:/u);

/**
 * Catalog index documents deliberately omit Markdown text while retaining
 * enough metadata for the Renderer to distinguish unloaded content from a
 * genuinely empty file.
 */
export const CatalogIndexDocumentSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    content: z.literal(""),
    contentBytes: CatalogContentBytesSchema,
    contentStamp: CatalogContentStampSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type CatalogIndexDocument = z.infer<typeof CatalogIndexDocumentSchema>;

const CatalogIndexDraftSectionSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: CatalogIndexDocumentSchema,
    characterState: CatalogIndexDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const CatalogIndexDraftDirectorySchema = z
  .object({
    id: z.literal(CATALOG_DRAFT_DIRECTORY_ID),
    title: CatalogTitleSchema,
    sections: z.array(CatalogIndexDraftSectionSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const CatalogIndexShortBookSchema = CurrentShortBookSchema.extend({
  documents: z.array(CatalogIndexDocumentSchema),
  draft: CatalogIndexDraftDirectorySchema
}).strict();

const CatalogIndexScriptBookSchema = CurrentScriptBookSchema.extend({
  documents: z.array(CatalogIndexDocumentSchema),
  draft: CatalogIndexDraftDirectorySchema
}).strict();

export const CatalogIndexBookSchema = z.discriminatedUnion("bookType", [
  CatalogIndexShortBookSchema,
  CatalogIndexScriptBookSchema,
  CatalogIndexAcademicBookSchema
]);
export type CatalogIndexBook = z.infer<typeof CatalogIndexBookSchema>;

export const CatalogIndexMaterialEntrySchema = MaterialEntrySchema.extend({
  body: z.literal(""),
  contentBytes: CatalogContentBytesSchema,
  contentStamp: CatalogContentStampSchema
}).strict();

export const CatalogIndexMaterialLibrarySchema = MaterialLibrarySchema.extend({
  overview: z.literal(""),
  overviewContentBytes: CatalogContentBytesSchema,
  overviewContentStamp: CatalogContentStampSchema,
  entries: z.array(CatalogIndexMaterialEntrySchema)
}).strict();

export const CatalogIndexSkillEntrySchema = SkillEntrySchema.extend({
  body: z.literal(""),
  contentBytes: CatalogContentBytesSchema,
  contentStamp: CatalogContentStampSchema
}).strict();

export const CatalogIndexSkillLibrarySchema = SkillLibrarySchema.extend({
  overview: z.literal(""),
  overviewContentBytes: CatalogContentBytesSchema,
  overviewContentStamp: CatalogContentStampSchema,
  entries: z.array(CatalogIndexSkillEntrySchema)
}).strict();

export const CatalogIndexSnapshotObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    libraryOrganization: LibraryOrganizationSchema.optional(),
    creativePlotStages: CreativePlotStagesSchema,
    books: z.array(CatalogIndexBookSchema),
    materials: z.array(CatalogIndexMaterialLibrarySchema),
    materialGroups: z.array(MaterialLibraryGroupSchema),
    skills: z.array(CatalogIndexSkillLibrarySchema),
    skillGroups: z.array(SkillLibraryGroupSchema),
    updatedAt: TimestampSchema,
    legacyImport: CatalogLegacyImportSchema.optional(),
    projectDiagnostics: z.array(CatalogProjectDiagnosticSchema).optional()
  })
  .strict();

/**
 * A metadata-only structural projection of CatalogSnapshot. All Markdown and
 * library overview text is fixed to an empty string; byte counts describe the
 * source content without loading it.
 */
export const CatalogIndexSnapshotSchema =
  CatalogIndexSnapshotObjectSchema.superRefine((snapshot, context) => {
    const compatible = CatalogSnapshotSchema.safeParse(snapshot);
    if (!compatible.success) {
      context.addIssue({
        code: "custom",
        message:
          "Catalog index must remain structurally compatible with CatalogSnapshot."
      });
    }
  });
export type CatalogIndexSnapshot = z.infer<typeof CatalogIndexSnapshotSchema>;
