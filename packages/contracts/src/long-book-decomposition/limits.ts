import { z } from "zod";

export const DECOMPOSITION_MAX_CHAPTERS = 50_000;
export const DECOMPOSITION_MAX_CHARACTERS = 20_000_000;
export const DECOMPOSITION_MAX_CHUNK_CHAPTERS = 20;
export const DECOMPOSITION_MAX_CHUNK_TOKENS = 60_000;
export const DECOMPOSITION_WORK_PACKAGE_SIZE = 20;
export const DECOMPOSITION_QUERY_CHARACTERS = 12_000;
export const DECOMPOSITION_MIN_CONTEXT_WINDOW = 16_000;
export const DECOMPOSITION_MAX_ATTEMPTS = 3;
/**
 * Child runs carry their evidence from the first request, so they compact
 * only near the window: a share of the model window, never a fixed size.
 */
export const DECOMPOSITION_CHILD_CONTEXT_RATIO = 0.8;
/** Share of the usable window the system-assembled evidence may fill. */
export const DECOMPOSITION_EVIDENCE_RATIO = 0.5;
/** Follow-up lookups per child; the evidence arrives up front. */
export const DECOMPOSITION_CHILD_QUERY_LIMIT = 6;
/** Schema ceiling of one evidence pack; Core sizes packs by model budget. */
export const DECOMPOSITION_BRIEF_MAX_CHARACTERS = 2_000_000;
/** Pause once actual usage passes the high estimate by this factor. */
export const DECOMPOSITION_USAGE_LIMIT_FACTOR = 2;
export const DecompositionIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9_:-]+$/iu);
export const DecompositionTextSchema = z.string().trim().min(1).max(200_000);
export const DecompositionRangeSchema = z
  .object({
    start: z.number().int().min(1).max(DECOMPOSITION_MAX_CHAPTERS),
    end: z.number().int().min(1).max(DECOMPOSITION_MAX_CHAPTERS)
  })
  .refine(({ start, end }) => start <= end, "章节范围无效。");
export const DecompositionPhaseSchema = z.enum([
  "prepare_target",
  "read",
  "registry",
  "registry_review",
  "integrate",
  "review",
  "finalize",
  "done"
]);
export const DecompositionRunPhaseSchema = z.enum([
  "read",
  "registry",
  "integrate",
  "review"
]);
export type DecompositionPhase = z.infer<typeof DecompositionPhaseSchema>;
export type DecompositionRunPhase = z.infer<typeof DecompositionRunPhaseSchema>;
