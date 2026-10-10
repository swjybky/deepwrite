import { z } from "zod";
import { CatalogIdSchema, MaterialKindSchema } from "../catalog/kinds";
import { LongBookIdSchema, LongChapterCardIdSchema } from "../long-workspace";
import {
  LONG_MATERIAL_ENTRY_STATUSES,
  LongMaterialEntryViewSchema,
  LongMaterialPackSummarySchema
} from "./record";

const Count = z.number().int().nonnegative();

/** What the page shows after choosing a long book; nothing is written. */
export const LongMaterialSourceStatsSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().min(1).max(256),
    genre: z.string().max(120),
    worldCategories: Count,
    worldItems: Count,
    characters: z
      .object({
        protagonist: Count,
        major: Count,
        minor: Count,
        passerby: Count,
        other: Count
      })
      .strict(),
    volumes: Count,
    arcs: Count,
    chapterCards: Count,
    writtenChapters: Count,
    foreshadowing: Count,
    storyEvents: Count,
    chapters: z
      .array(
        z
          .object({
            id: LongChapterCardIdSchema,
            number: z.number().int().positive(),
            title: z.string().max(256),
            written: z.boolean()
          })
          .strict()
      )
      .max(100_000),
    decomposition: z
      .object({
        jobId: z.string().min(1).max(256),
        completed: z.boolean(),
        hasStyle: z.boolean()
      })
      .strict()
      .optional(),
    packs: z.array(LongMaterialPackSummarySchema).max(500)
  })
  .strict();
export type LongMaterialSourceStats = z.infer<
  typeof LongMaterialSourceStatsSchema
>;

export const LongMaterialLibraryPreviewSchema = z
  .object({
    kind: MaterialKindSchema,
    title: z.string().min(1).max(256),
    libraryId: CatalogIdSchema.optional(),
    characters: Count,
    entries: z.array(LongMaterialEntryViewSchema).max(4096)
  })
  .strict();
export type LongMaterialLibraryPreview = z.infer<
  typeof LongMaterialLibraryPreviewSchema
>;

export const LongMaterialStatusCountsSchema = z
  .object(
    Object.fromEntries(
      LONG_MATERIAL_ENTRY_STATUSES.map((status) => [status, Count])
    ) as Record<(typeof LONG_MATERIAL_ENTRY_STATUSES)[number], typeof Count>
  )
  .strict();
export type LongMaterialStatusCounts = z.infer<
  typeof LongMaterialStatusCountsSchema
>;

export const LongMaterialPreviewSchema = z
  .object({
    bookId: LongBookIdSchema,
    groupTitle: z.string().min(1).max(256),
    libraries: z.array(LongMaterialLibraryPreviewSchema).length(5),
    totalEntries: Count,
    totalCharacters: Count,
    splitCount: Count,
    chaptersPerEntry: z.number().int().positive(),
    counts: LongMaterialStatusCountsSchema,
    capacityOk: z.boolean(),
    warnings: z.array(z.string().max(300)).max(20)
  })
  .strict();
export type LongMaterialPreview = z.infer<typeof LongMaterialPreviewSchema>;

/** Conversion, conflict resolution and guide writes all report this shape. */
export const LongMaterialConvertResultSchema = z
  .object({
    pack: LongMaterialPackSummarySchema,
    libraries: z
      .array(
        z
          .object({
            kind: MaterialKindSchema,
            libraryId: CatalogIdSchema,
            title: z.string().min(1).max(256)
          })
          .strict()
      )
      .length(5),
    entries: z.array(LongMaterialEntryViewSchema).max(20_480),
    counts: LongMaterialStatusCountsSchema
  })
  .strict();
export type LongMaterialConvertResult = z.infer<
  typeof LongMaterialConvertResultSchema
>;

export const LongMaterialProgressPayloadSchema = z
  .object({
    operationId: z.string().min(1).max(120),
    phase: z.enum(["reading", "writing", "ordering", "finished"]),
    done: Count,
    total: Count
  })
  .strict();
export type LongMaterialProgressPayload = z.infer<
  typeof LongMaterialProgressPayloadSchema
>;
