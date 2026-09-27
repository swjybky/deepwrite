import { z } from "zod";
export const LONG_BOOK_ANALYSIS_MAX_PRESETS = 50;
// Allows the three required built-ins to be restored for legacy configurations
// that already reached the user-facing preset limit without them.
export const LONG_BOOK_ANALYSIS_MAX_PERSISTED_PRESETS =
  LONG_BOOK_ANALYSIS_MAX_PRESETS + 3;
export const LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS = 50;
export const LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS = 10_000;
export const LONG_BOOK_ANALYSIS_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const LONG_BOOK_ANALYSIS_MAX_DIRECTORY_BYTES = 100 * 1024 * 1024;
export const LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS = 50_000_000;
export const LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS = 10_000_000;
export const LONG_BOOK_ANALYSIS_MAX_PROMPT_CHARACTERS = 200_000;
export const LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS = 12_000;
export const LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS = 200_000;
export const LONG_BOOK_ANALYSIS_DEFAULT_CONTEXT_WINDOW = 272_000;

export const LongBookAnalysisIdSchema = z.string().trim().min(1).max(120);
export const LongBookAnalysisTitleSchema = z.string().trim().min(1).max(256);
export const LongBookAnalysisLibraryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512);

// Moved here from `long-book-analysis` so `long-book-analysis-plan` can use them
// without closing a cycle: plan -> long-book-analysis -> commands -> plan.
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
