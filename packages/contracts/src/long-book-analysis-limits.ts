import { z } from "zod";
export const LONG_BOOK_ANALYSIS_MAX_PRESETS = 50;
// Allows the three required built-ins to be restored for legacy configurations
// that already reached the user-facing preset limit without them.
export const LONG_BOOK_ANALYSIS_MAX_PERSISTED_PRESETS =
  LONG_BOOK_ANALYSIS_MAX_PRESETS + 3;
export const LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS = 50;
export const LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS = 50_000;
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
