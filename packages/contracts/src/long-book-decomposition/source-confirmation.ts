import { z } from "zod";
import {
  LongBookAnalysisChapterSchema,
  LongBookAnalysisSavedSourceIdSchema
} from "../long-book-analysis-sources";
import {
  DECOMPOSITION_MAX_CHAPTERS,
  DecompositionIdSchema,
  DecompositionRangeSchema
} from "./limits";
export const DecompositionSourceConfirmationSchema = z.object({
  id: DecompositionIdSchema,
  sourceId: LongBookAnalysisSavedSourceIdSchema,
  sourceRevision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  range: DecompositionRangeSchema,
  confirmedAt: z.string().datetime()
});
export type DecompositionSourceConfirmation = z.infer<
  typeof DecompositionSourceConfirmationSchema
>;
export const SaveLongBookSourceInputSchema = z.object({
  sourceId: LongBookAnalysisSavedSourceIdSchema,
  baseRevision: z.number().int().nonnegative(),
  chapters: z
    .array(LongBookAnalysisChapterSchema)
    .min(1)
    .max(DECOMPOSITION_MAX_CHAPTERS)
});
export const ConfirmLongBookSourceInputSchema = z.object({
  sourceId: LongBookAnalysisSavedSourceIdSchema,
  sourceRevision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  range: DecompositionRangeSchema
});

export type SaveLongBookSourceInput = z.infer<
  typeof SaveLongBookSourceInputSchema
>;
export type ConfirmLongBookSourceInput = z.infer<
  typeof ConfirmLongBookSourceInputSchema
>;
