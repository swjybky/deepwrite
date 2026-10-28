import { z } from "zod";
import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS,
  LongBookAnalysisIdSchema,
  LongBookAnalysisTitleSchema
} from "./long-book-analysis-limits";
export * from "./long-book-analysis-limits";
export * from "./long-book-analysis-presets";
export * from "./long-book-analysis-sources";
export * from "./long-book-analysis-commands";
export const LongBookAnalysisSegmentSchema = z.object({
  id: LongBookAnalysisIdSchema,
  chapterId: LongBookAnalysisIdSchema,
  chapterOrder: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  chapterTitle: LongBookAnalysisTitleSchema,
  volume: z.string().trim().min(1).max(256).optional(),
  segmentIndex: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS)
});
export type LongBookAnalysisSegment = z.infer<
  typeof LongBookAnalysisSegmentSchema
>;

export const LongBookAnalysisNoteSchema = z
  .object({
    id: LongBookAnalysisIdSchema,
    label: z.string().trim().min(1).max(256),
    chapterStart: z
      .number()
      .int()
      .positive()
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    chapterEnd: z
      .number()
      .int()
      .positive()
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS)
  })
  .superRefine((value, context) => {
    if (value.chapterEnd < value.chapterStart) {
      context.addIssue({
        code: "custom",
        path: ["chapterEnd"],
        message: "Analysis note chapterEnd must not precede chapterStart."
      });
    }
  });
export type LongBookAnalysisNote = z.infer<typeof LongBookAnalysisNoteSchema>;

const RuntimeBaseSchema = z.object({
  jobId: LongBookAnalysisIdSchema,
  unitId: LongBookAnalysisIdSchema,
  sourceTitle: z.string().trim().min(1).max(1_024),
  selectionStart: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  selectionEnd: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
});

export const LongBookAnalysisRuntimeContextSchema = z
  .discriminatedUnion("phase", [
    RuntimeBaseSchema.extend({
      phase: z.literal("batch"),
      segments: z.array(LongBookAnalysisSegmentSchema).min(1).max(100)
    }),
    RuntimeBaseSchema.extend({
      phase: z.literal("reduce"),
      notes: z.array(LongBookAnalysisNoteSchema).min(2).max(100)
    }),
    RuntimeBaseSchema.extend({
      phase: z.literal("final"),
      notes: z.array(LongBookAnalysisNoteSchema).min(1).max(100)
    })
  ])
  .superRefine((value, context) => {
    if (value.selectionEnd < value.selectionStart) {
      context.addIssue({
        code: "custom",
        path: ["selectionEnd"],
        message: "Analysis selectionEnd must not precede selectionStart."
      });
    }
    if (
      value.selectionEnd - value.selectionStart + 1 >
      LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectionEnd"],
        message: `Long-book analysis may include at most ${LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS} chapters.`
      });
    }
  });
export type LongBookAnalysisRuntimeContext = z.infer<
  typeof LongBookAnalysisRuntimeContextSchema
>;

export const LongBookAnalysisResultSchema = z.object({
  name: LongBookAnalysisTitleSchema,
  description: z.string().trim().min(1).max(1_000),
  content: z
    .string()
    .trim()
    .min(1)
    .max(LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS)
});
export type LongBookAnalysisResult = z.infer<
  typeof LongBookAnalysisResultSchema
>;

export const LongBookAnalysisNoteWriteSchema = z.object({
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS)
});
export type LongBookAnalysisNoteWrite = z.infer<
  typeof LongBookAnalysisNoteWriteSchema
>;
