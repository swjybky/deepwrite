import { z } from "zod";
import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS,
  LongBookAnalysisIdSchema,
  LongBookAnalysisTitleSchema,
  LongBookAnalysisNoteSchema,
  LongBookAnalysisResultSchema
} from "./long-book-analysis-limits";
export * from "./long-book-analysis-limits";
export * from "./long-book-analysis-presets";
export * from "./long-book-analysis-sources";
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


const RuntimeBaseSchema = z.object({
  jobId: LongBookAnalysisIdSchema,
  unitId: LongBookAnalysisIdSchema,
  presetId: LongBookAnalysisIdSchema,
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
        message: "Long-book analysis may include at most 50 chapters."
      });
    }
  });
export type LongBookAnalysisRuntimeContext = z.infer<
  typeof LongBookAnalysisRuntimeContextSchema
>;


export const LongBookAnalysisNoteWriteSchema = z.object({
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS)
});
export type LongBookAnalysisNoteWrite = z.infer<
  typeof LongBookAnalysisNoteWriteSchema
>;

// NOTE: this module deliberately does NOT `export * from
// "./long-book-analysis-commands". The command envelopes import the plan schema
// from `long-book-analysis-plan`, and the plan schema imports the result schema
// from here, so that re-export closes a cycle: long-book-analysis -> commands ->
// plan -> long-book-analysis. `export *` is hoisted, so moving it to the bottom
// of the file does not help — the cycle has to be broken by edge, not by order.
// The commands are re-exported from `index.ts` instead, and `system.ts` imports
// them straight from "./long-book-analysis-commands".
