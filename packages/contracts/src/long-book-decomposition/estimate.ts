import { z } from "zod";
import { DECOMPOSITION_DEFAULT_CONCURRENCY } from "./limits";

const range = z.tuple([z.number(), z.number()]);
export const DecompositionEstimateSchema = z.object({
  chapters: z.number().int().positive(),
  characters: z.number().int().positive(),
  chunks: z.number().int().positive(),
  /** Every input token sent, including re-sent history that may hit a cache. */
  inputTokens: range,
  /** Share of the input that repeats an earlier request's prefix. */
  cachedInputTokens: range,
  outputTokens: range,
  minutes: range,
  /** Model requests, counting every turn of every child. */
  calls: z.number().int().positive()
});
export type DecompositionEstimate = z.infer<typeof DecompositionEstimateSchema>;

/** System prompt and tool schemas each child request carries. */
const FIXED_TOKENS = 6000;
const pair = (low: number, high: number) =>
  [Math.ceil(low), Math.ceil(high)] as [number, number];

/**
 * Children receive their evidence with the task and submit in batches, so a
 * child costs about two requests: the evidence once, then a short follow-up
 * that re-sends it. Every re-sent token counts as input here.
 */
export function estimateDecomposition(
  chapters: number,
  characters: number,
  chunks: number,
  /** Children running at once; wall time shrinks with it. */
  concurrency = DECOMPOSITION_DEFAULT_CONCURRENCY
): DecompositionEstimate {
  const source = pair(characters * 1.0, characters * 1.5);
  // Reading: one child per chunk; records run to 35–80% of the source.
  const readOutput = pair(source[0] * 0.35, source[1] * 0.8);
  const readInput = pair(
    chunks * FIXED_TOKENS * 2 + source[0] * 2 + readOutput[0],
    chunks * FIXED_TOKENS * 3 + source[1] * 3 + readOutput[1] * 2
  );
  const cards = pair(source[0] * 0.3, source[1] * 0.6);
  // Registry slices and merge read compact name lists.
  const registryInput = pair(cards[0] * 0.2, cards[1] * 0.6);
  // Integration: characters (minor ones grouped), world, chronicles, plot,
  // style, continuity and reviews; each card fact feeds one or two packs.
  const units = pair(chapters * 0.5 + 15, chapters * 1.6 + 30);
  const tasks = pair(units[0] * 0.4, units[1]);
  const integrateOutput = pair(units[0] * 1500, units[1] * 4000);
  const evidence = pair(cards[0], cards[1] * 2);
  const integrateInput = pair(
    tasks[0] * FIXED_TOKENS * 2 + evidence[0] * 2 + integrateOutput[0],
    tasks[1] * FIXED_TOKENS * 3 + evidence[1] * 3 + integrateOutput[1] * 2
  );
  // Each work package's coordinator holds a short dispatch conversation.
  const packages = pair(
    Math.ceil(chunks / 20) + Math.ceil(units[0] / 20) + 2,
    Math.ceil(chunks / 20) + Math.ceil(units[1] / 20) + 2
  );
  const coordinatorInput = pair(packages[0] * 40_000, packages[1] * 300_000);
  const inputTokens = pair(
    readInput[0] + registryInput[0] + integrateInput[0] + coordinatorInput[0],
    readInput[1] + registryInput[1] + integrateInput[1] + coordinatorInput[1]
  );
  // Evidence and fixed prompts are new the first time; the rest repeats.
  const firstSeen = pair(
    source[0] + evidence[0] + (chunks + tasks[0]) * FIXED_TOKENS,
    source[1] + evidence[1] + (chunks + tasks[1]) * FIXED_TOKENS
  );
  const calls = Math.ceil(chunks * 2.5 + tasks[1] * 2.5 + packages[1] * 7 + 4);
  return DecompositionEstimateSchema.parse({
    chapters,
    characters,
    chunks,
    inputTokens,
    cachedInputTokens: pair(
      Math.max(0, inputTokens[0] - firstSeen[0]),
      Math.max(0, inputTokens[1] - firstSeen[1])
    ),
    outputTokens: pair(
      readOutput[0] + integrateOutput[0],
      readOutput[1] + integrateOutput[1] + registryInput[1] * 0.5
    ),
    minutes: pair((calls / concurrency) * 0.5, (calls / concurrency) * 1.5),
    calls
  });
}
