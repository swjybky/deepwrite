import { z } from "zod";
import {
  CatalogIdSchema,
  MaterialKindSchema,
  MaterialStageIdSchema
} from "../catalog/kinds";
import { LongBookIdSchema } from "../long-workspace";
import { LongMaterialEntryKeySchema, LongMaterialPackIdSchema } from "./limits";
import { LongMaterialPackOptionsSchema } from "./options";
import { LongMaterialBookStatsSchema } from "./source";
import { LongMaterialGuideSubmissionSchema } from "./guide";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.string().datetime();

export const LongMaterialLibraryIdsSchema = z
  .object({
    character: CatalogIdSchema,
    gimmick: CatalogIdSchema,
    plot: CatalogIdSchema,
    draft: CatalogIdSchema,
    other: CatalogIdSchema
  })
  .strict();
export type LongMaterialLibraryIds = z.infer<
  typeof LongMaterialLibraryIdsSchema
>;

/** What this feature last wrote to one entry; content stays in the library. */
export const LongMaterialRecordEntrySchema = z
  .object({
    entryId: CatalogIdSchema,
    libraryId: CatalogIdSchema,
    kind: MaterialKindSchema,
    stageId: MaterialStageIdSchema,
    title: z.string().min(1).max(256),
    description: z.string().max(200),
    sha256: Sha256Schema,
    /** The user deleted the entry; later conversions leave it out. */
    deleted: z.literal(true).optional()
  })
  .strict();
export type LongMaterialRecordEntry = z.infer<
  typeof LongMaterialRecordEntrySchema
>;

/**
 * Device-local conversion record under `<workspace>/long-material-packs/`.
 * `pending` lists the hashes a conversion is about to write, so an
 * interrupted run recognises its own writes instead of reporting conflicts.
 */
export const LongMaterialPackRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: LongMaterialPackIdSchema,
    bookId: LongBookIdSchema,
    bookTitle: z.string().min(1).max(256),
    groupId: CatalogIdSchema,
    libraryIds: LongMaterialLibraryIdsSchema,
    options: LongMaterialPackOptionsSchema,
    chaptersPerEntry: z.number().int().positive().max(500),
    stats: LongMaterialBookStatsSchema,
    entries: z.record(
      LongMaterialEntryKeySchema,
      LongMaterialRecordEntrySchema
    ),
    pending: z.record(LongMaterialEntryKeySchema, Sha256Schema).optional(),
    /** The last guide run, kept so every conversion can rebuild its entries. */
    guide: z
      .object({
        generatedAt: TimestampSchema,
        modelLabel: z.string().max(200).optional(),
        submission: LongMaterialGuideSubmissionSchema
      })
      .strict()
      .optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    convertedAt: TimestampSchema.optional()
  })
  .strict();
export type LongMaterialPackRecord = z.infer<
  typeof LongMaterialPackRecordSchema
>;

export const LongMaterialPackSummarySchema = z
  .object({
    id: LongMaterialPackIdSchema,
    bookId: LongBookIdSchema,
    bookTitle: z.string().min(1).max(256),
    groupId: CatalogIdSchema,
    groupTitle: z.string().max(256).optional(),
    entryCount: z.number().int().nonnegative(),
    guideGeneratedAt: TimestampSchema.optional(),
    convertedAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema
  })
  .strict();
export type LongMaterialPackSummary = z.infer<
  typeof LongMaterialPackSummarySchema
>;

export const LONG_MATERIAL_ENTRY_STATUSES = [
  "new",
  "updated",
  "unchanged",
  "conflict",
  "stale",
  "deleted"
] as const;
export const LongMaterialEntryStatusSchema = z.enum(
  LONG_MATERIAL_ENTRY_STATUSES
);
export type LongMaterialEntryStatus = z.infer<
  typeof LongMaterialEntryStatusSchema
>;

/** One planned or written entry as the page shows it; no content. */
export const LongMaterialEntryViewSchema = z
  .object({
    key: LongMaterialEntryKeySchema,
    kind: MaterialKindSchema,
    stageId: MaterialStageIdSchema,
    title: z.string().min(1).max(256),
    characters: z.number().int().nonnegative(),
    enhanced: z.boolean().optional(),
    status: LongMaterialEntryStatusSchema.optional(),
    libraryId: CatalogIdSchema.optional(),
    entryId: CatalogIdSchema.optional()
  })
  .strict();
export type LongMaterialEntryView = z.infer<typeof LongMaterialEntryViewSchema>;
