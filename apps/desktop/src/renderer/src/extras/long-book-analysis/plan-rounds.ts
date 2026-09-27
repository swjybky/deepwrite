import { LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS } from "@deepwrite/contracts/renderer";

export interface AnalysisRoundRange {
  /** Zero-based position of this window in the plan. */
  index: number;
  startOrder: number;
  endOrder: number;
}

/**
 * Split a whole-book selection into the ≤50-chapter windows a single analysis
 * run can accept. The pipeline's own limit is untouched — each window becomes
 * an independent, compliant job.
 */
export function buildAnalysisRoundRanges(
  startOrder: number,
  endOrder: number
): AnalysisRoundRange[] {
  if (endOrder < startOrder) return [];
  const ranges: AnalysisRoundRange[] = [];
  for (
    let start = startOrder;
    start <= endOrder;
    start += LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
  ) {
    ranges.push({
      index: ranges.length,
      startOrder: start,
      // The final window is short whenever the count is not a multiple of 50.
      endOrder: Math.min(
        start + LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS - 1,
        endOrder
      )
    });
  }
  return ranges;
}
