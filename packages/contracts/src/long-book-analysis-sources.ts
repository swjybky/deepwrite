import { z } from "zod";
import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS,
  LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS,
  LongBookAnalysisIdSchema,
  LongBookAnalysisTitleSchema
} from "./long-book-analysis-limits";
export const LongBookAnalysisChapterSchema = z.object({
  id: LongBookAnalysisIdSchema,
  order: z.number().int().min(1).max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  title: LongBookAnalysisTitleSchema,
  rawHeading: z
    .string()
    .max(1_024)
    .refine((value) => value.trim().length > 0 && !/[\r\n]/u.test(value), {
      message: "Chapter rawHeading must be a single non-empty line."
    })
    .optional(),
  volume: z.string().trim().min(1).max(256).optional(),
  sourceName: z.string().trim().min(1).max(1_024),
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS),
  charCount: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS)
});
export type LongBookAnalysisChapter = z.infer<
  typeof LongBookAnalysisChapterSchema
>;

export const LongBookAnalysisDiagnosticSchema = z.object({
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1_000),
  sourceName: z.string().trim().min(1).max(1_024).optional()
});
export type LongBookAnalysisDiagnostic = z.infer<
  typeof LongBookAnalysisDiagnosticSchema
>;

export const LongBookAnalysisSourceSchema = z
  .object({
    id: LongBookAnalysisIdSchema,
    revision: z.number().int().positive().optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    kind: z.enum(["txt", "directory"]),
    name: z.string().trim().min(1).max(1_024),
    chapters: z
      .array(LongBookAnalysisChapterSchema)
      .min(1)
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    diagnostics: z.array(LongBookAnalysisDiagnosticSchema).max(1_000)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    let totalCharacters = 0;
    value.chapters.forEach((chapter, index) => {
      if (ids.has(chapter.id)) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "id"],
          message: "Long-book analysis chapter ids must be unique."
        });
      }
      ids.add(chapter.id);
      if (chapter.order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "order"],
          message: "Long-book analysis chapter order must be contiguous."
        });
      }
      totalCharacters += chapter.text.length;
    });
    if (totalCharacters > LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "Long-book analysis source exceeds the total character limit."
      });
    }
  });
export type LongBookAnalysisSource = z.infer<
  typeof LongBookAnalysisSourceSchema
>;

export const LongBookAnalysisSourceKindSchema = z.enum(["txt", "directory"]);
export type LongBookAnalysisSourceKind = z.infer<
  typeof LongBookAnalysisSourceKindSchema
>;

export const LongBookAnalysisSavedSourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_-]+$/iu);
export type LongBookAnalysisSavedSourceId = z.infer<
  typeof LongBookAnalysisSavedSourceIdSchema
>;

export const LongBookAnalysisSavedSourceSummarySchema = z.object({
  id: LongBookAnalysisSavedSourceIdSchema,
  kind: LongBookAnalysisSourceKindSchema,
  name: z.string().trim().min(1).max(1_024),
  chapterCount: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  characterCount: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS),
  importedAt: z.string().datetime()
});
export type LongBookAnalysisSavedSourceSummary = z.infer<
  typeof LongBookAnalysisSavedSourceSummarySchema
>;

export const LongBookAnalysisSavedSourceCatalogSchema = z.object({
  sources: z
    .array(LongBookAnalysisSavedSourceSummarySchema)
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
});
export type LongBookAnalysisSavedSourceCatalog = z.infer<
  typeof LongBookAnalysisSavedSourceCatalogSchema
>;
