import { z } from "zod";
import type { LongBookAnalysisChapter } from "../long-book-analysis-sources";
import {
  decompositionBatchLimit,
  type DecompositionModelCapacity
} from "./output-budget";
import {
  DECOMPOSITION_CHILD_CONTEXT_RATIO,
  DECOMPOSITION_EVIDENCE_RATIO,
  DECOMPOSITION_MAX_CHUNK_CHAPTERS,
  DECOMPOSITION_MAX_CHUNK_TOKENS,
  DECOMPOSITION_MIN_CONTEXT_WINDOW,
  DecompositionIdSchema
} from "./limits";

export const DecompositionChunkSchema = z.object({
  id: DecompositionIdSchema,
  volume: z.string().optional(),
  startOrder: z.number().int().positive(),
  endOrder: z.number().int().positive(),
  chapterIds: z.array(DecompositionIdSchema).min(1).max(20),
  segment: z
    .object({
      chapterId: DecompositionIdSchema,
      index: z.number().int().nonnegative(),
      count: z.number().int().positive(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive()
    })
    .optional(),
  estimatedTokens: z
    .number()
    .int()
    .positive()
    .max(DECOMPOSITION_MAX_CHUNK_TOKENS)
});
export type DecompositionChunk = z.infer<typeof DecompositionChunkSchema>;
export function decompositionInputBudget(
  model: DecompositionModelCapacity,
  promptCharacters = 0
): number {
  if (
    !model.contextWindow ||
    model.contextWindow < DECOMPOSITION_MIN_CONTEXT_WINDOW
  )
    throw new Error("整书拆解模型窗口至少需要 16,000 token。");
  const budget = Math.floor(
    (model.contextWindow -
      Math.min(model.maxTokens ?? 4096, 8192) -
      3000 -
      promptCharacters * 1.5) *
      0.6
  );
  if (budget < 1000) throw new Error("模型窗口不足以容纳拆解方案。");
  return Math.min(DECOMPOSITION_MAX_CHUNK_TOKENS, budget);
}
export function limitingDecompositionReadingModel<
  T extends DecompositionModelCapacity
>(models: readonly T[], promptCharacters = 0): T {
  if (!models.length) throw new Error("请选择可用的拆解模型。");
  let limiting = models[0]!;
  let minBudget = decompositionInputBudget(limiting, promptCharacters);
  for (const candidate of models.slice(1)) {
    const budget = decompositionInputBudget(candidate, promptCharacters);
    if (budget < minBudget) {
      minBudget = budget;
      limiting = candidate;
    }
  }
  return limiting;
}
const outputReserve = (model: DecompositionModelCapacity) =>
  Math.min(model.maxTokens ?? 4096, 32_768);
/** Evidence a child receives with its task, as a share of the usable window. */
export function decompositionEvidenceBudget(
  model: DecompositionModelCapacity
): number {
  const window = model.contextWindow ?? DECOMPOSITION_MIN_CONTEXT_WINDOW;
  return Math.max(
    4000,
    Math.floor(
      (window - outputReserve(model) - 8000) * DECOMPOSITION_EVIDENCE_RATIO
    )
  );
}
/** Child compaction starts only near the window, in proportion to it. */
export function decompositionChildContextBudget(
  model: DecompositionModelCapacity
): number {
  const window = model.contextWindow ?? DECOMPOSITION_MIN_CONTEXT_WINDOW;
  return Math.floor(window * DECOMPOSITION_CHILD_CONTEXT_RATIO);
}
/**
 * Chapters one submission call can carry within the model's output limit
 * after reasoning; smaller calls also put the first chapters on screen sooner.
 */
export function decompositionChaptersPerSubmission(
  model: DecompositionModelCapacity
): number {
  return Math.min(
    DECOMPOSITION_MAX_CHUNK_CHAPTERS,
    decompositionBatchLimit(model, "readingChapter")
  );
}
export function splitDecompositionChunks(
  chapters: readonly LongBookAnalysisChapter[],
  model: DecompositionModelCapacity,
  promptCharacters = 0
): DecompositionChunk[] {
  const budget = decompositionInputBudget(model, promptCharacters);
  const maxCharacters = Math.floor(budget / 1.5);
  const chunks: DecompositionChunk[] = [];
  let pending: LongBookAnalysisChapter[] = [];
  let tokens = 0;
  function flush() {
    if (!pending.length) return;
    chunks.push({
      id: `chunk:${chunks.length + 1}`,
      startOrder: pending[0]!.order,
      endOrder: pending.at(-1)!.order,
      ...(pending[0]!.volume ? { volume: pending[0]!.volume } : {}),
      chapterIds: pending.map(({ id }) => id),
      estimatedTokens: tokens
    });
    pending = [];
    tokens = 0;
  }
  for (const chapter of chapters) {
    const cost = Math.ceil(chapter.text.length * 1.5);
    if (cost > budget) {
      flush();
      const spans: Array<{ start: number; end: number }> = [];
      for (let start = 0; start < chapter.text.length;) {
        let end = Math.min(chapter.text.length, start + maxCharacters);
        if (end < chapter.text.length) {
          const paragraph = chapter.text.lastIndexOf("\n", end - 1);
          if (paragraph > start + maxCharacters / 2) end = paragraph + 1;
          if (/[\uD800-\uDBFF]/u.test(chapter.text[end - 1]!)) end--;
        }
        spans.push({ start, end });
        start = end;
      }
      spans.forEach((span, index) =>
        chunks.push({
          id: `chunk:${chunks.length + 1}`,
          startOrder: chapter.order,
          endOrder: chapter.order,
          chapterIds: [chapter.id],
          ...(chapter.volume ? { volume: chapter.volume } : {}),
          segment: {
            chapterId: chapter.id,
            index,
            count: spans.length,
            ...span
          },
          estimatedTokens: Math.ceil((span.end - span.start) * 1.5)
        })
      );
      continue;
    }
    if (
      pending.length &&
      (pending[0]!.volume !== chapter.volume ||
        pending.length >= DECOMPOSITION_MAX_CHUNK_CHAPTERS ||
        tokens + cost > budget)
    )
      flush();
    pending.push(chapter);
    tokens += cost;
  }
  flush();
  return chunks.map((chunk) => DecompositionChunkSchema.parse(chunk));
}
export function decompositionReadingUnitId(
  chunk: DecompositionChunk,
  chapterId: string
): string {
  return `reading:${chapterId}${chunk.segment ? `:${chunk.segment.index}` : ""}`;
}
export function splitDecompositionChronicles(
  chunks: readonly DecompositionChunk[],
  model: DecompositionModelCapacity
) {
  // A segment's digest (summaries, events, beats) arrives as one evidence
  // pack, and its chronicle is written in one call: segments follow both the
  // evidence budget and the output budget of the integration model.
  const budget = decompositionEvidenceBudget(model);
  const chapterLimit = decompositionBatchLimit(model, "chronicleChapter");
  const segments: Array<{ id: string; volume?: string; chunkIds: string[] }> =
    [];
  let cost = 0;
  let chapters = 0;
  for (const chunk of chunks) {
    const size = Math.max(
      1000,
      Math.ceil(chunk.estimatedTokens * 0.15),
      chunk.chapterIds.length * 1500
    );
    let current = segments.at(-1);
    if (
      !current ||
      current.volume !== chunk.volume ||
      cost + size > budget ||
      chapters + chunk.chapterIds.length > chapterLimit
    ) {
      current = {
        id: `chronicle:${segments.length + 1}`,
        ...(chunk.volume ? { volume: chunk.volume } : {}),
        chunkIds: []
      };
      segments.push(current);
      cost = 0;
      chapters = 0;
    }
    current.chunkIds.push(chunk.id);
    cost += size;
    chapters += chunk.chapterIds.length;
  }
  return segments;
}
