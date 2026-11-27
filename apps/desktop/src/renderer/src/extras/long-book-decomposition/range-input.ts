export interface ChapterRange {
  start: number;
  end: number;
}

/** Clamp typed values into the book and keep the pair ordered around the edited side. */
export function normalizeChapterRange(
  range: { start: unknown; end: unknown },
  total: number,
  anchor: "start" | "end"
): ChapterRange {
  const clamp = (value: unknown) =>
    Math.max(1, Math.min(Math.max(1, total), Math.round(Number(value) || 1)));
  const start = clamp(range.start);
  const end = clamp(range.end);
  return anchor === "start"
    ? { start, end: Math.max(start, end) }
    : { start: Math.min(start, end), end };
}

export function syncDecompositionChapterRange(
  current: { start: unknown; end: unknown },
  nextTotal: number,
  previousTotal?: number
): ChapterRange {
  const total = Math.max(1, nextTotal);
  if (previousTotal === undefined) {
    return { start: 1, end: total };
  }
  const normalized = normalizeChapterRange(current, total, "end");
  if (
    Math.round(Number(current.end) || 0) === Math.max(1, previousTotal) &&
    total > Math.max(1, previousTotal)
  ) {
    return { start: normalized.start, end: total };
  }
  return normalized;
}
