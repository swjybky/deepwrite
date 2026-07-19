import type { AgentTextDiffHunk, AgentTextDiffLine } from "../types/conversation";

export interface AgentTextDiffOptions {
  contextLines?: number;
  maxRenderedLines?: number;
}

export interface AgentTextDiffResult {
  additions: number;
  deletions: number;
  hunks: AgentTextDiffHunk[];
  truncated: boolean;
}

type DiffOperation = {
  type: AgentTextDiffLine["type"];
  text: string;
};

type NumberedDiffLine = AgentTextDiffLine & {
  oldLinesBefore: number;
  newLinesBefore: number;
};

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_RENDERED_LINES = 500;
const MAX_MYERS_EDIT_DISTANCE = 2_000;
const MAX_MYERS_TRACE_CELLS = 1_000_000;
const MAX_MYERS_WORK = 2_000_000;

function normalizeLimit(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function mapValue(map: Map<number, number>, key: number): number {
  return map.get(key) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Computes a shortest line edit script while enforcing hard work and memory
 * budgets. Most document edits have a small edit distance, so Myers remains
 * fast even when unchanged text is long. A caller can safely fall back to a
 * coarse replacement when this returns undefined.
 */
function buildMyersOperations(before: string[], after: string[]): DiffOperation[] | undefined {
  if (before.length === 0) {
    return after.map((text) => ({ type: "addition", text }));
  }
  if (after.length === 0) {
    return before.map((text) => ({ type: "deletion", text }));
  }

  const maxDistance = Math.min(
    before.length + after.length,
    MAX_MYERS_EDIT_DISTANCE
  );
  const trace: Array<Map<number, number>> = [];
  let frontier = new Map<number, number>([[1, 0]]);
  let work = 0;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    if ((distance + 1) * (distance + 1) > MAX_MYERS_TRACE_CELLS) {
      return undefined;
    }
    trace.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_MYERS_WORK) {
        return undefined;
      }

      let oldIndex: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          mapValue(frontier, diagonal - 1) < mapValue(frontier, diagonal + 1))
      ) {
        oldIndex = mapValue(frontier, diagonal + 1);
      } else {
        oldIndex = mapValue(frontier, diagonal - 1) + 1;
      }
      if (!Number.isFinite(oldIndex)) {
        oldIndex = 0;
      }

      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < before.length &&
        newIndex < after.length &&
        before[oldIndex] === after[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
        work += 1;
        if (work > MAX_MYERS_WORK) {
          return undefined;
        }
      }
      frontier.set(diagonal, oldIndex);

      if (oldIndex >= before.length && newIndex >= after.length) {
        return backtrackMyers(trace, before, after);
      }
    }
  }

  return undefined;
}

function backtrackMyers(
  trace: Array<Map<number, number>>,
  before: string[],
  after: string[]
): DiffOperation[] {
  const reversed: DiffOperation[] = [];
  let oldIndex = before.length;
  let newIndex = after.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance]!;
    const diagonal = oldIndex - newIndex;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        mapValue(frontier, diagonal - 1) < mapValue(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousOldIndex = Math.max(0, mapValue(frontier, previousDiagonal));
    const previousNewIndex = previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      reversed.push({ type: "context", text: before[oldIndex - 1] ?? "" });
      oldIndex -= 1;
      newIndex -= 1;
    }

    if (distance === 0) {
      break;
    }
    if (oldIndex === previousOldIndex) {
      reversed.push({ type: "addition", text: after[newIndex - 1] ?? "" });
      newIndex -= 1;
    } else {
      reversed.push({ type: "deletion", text: before[oldIndex - 1] ?? "" });
      oldIndex -= 1;
    }
  }

  return reversed.reverse();
}

function numberOperations(
  operations: DiffOperation[],
  oldOffset: number,
  newOffset: number
): NumberedDiffLine[] {
  let oldLine = oldOffset;
  let newLine = newOffset;
  return operations.map((operation) => {
    const numbered: NumberedDiffLine = {
      type: operation.type,
      text: operation.text,
      oldLinesBefore: oldLine,
      newLinesBefore: newLine
    };
    if (operation.type !== "addition") {
      oldLine += 1;
      numbered.oldLineNumber = oldLine;
    }
    if (operation.type !== "deletion") {
      newLine += 1;
      numbered.newLineNumber = newLine;
    }
    return numbered;
  });
}

function publicLine(line: NumberedDiffLine): AgentTextDiffLine {
  return {
    type: line.type,
    text: line.text,
    ...(line.oldLineNumber === undefined ? {} : { oldLineNumber: line.oldLineNumber }),
    ...(line.newLineNumber === undefined ? {} : { newLineNumber: line.newLineNumber })
  };
}

function hunkFromRange(
  lines: NumberedDiffLine[],
  start: number,
  end: number
): AgentTextDiffHunk {
  const selected = lines.slice(start, end);
  const first = lines[start]!;
  const oldLines = selected.filter((line) => line.type !== "addition").length;
  const newLines = selected.filter((line) => line.type !== "deletion").length;
  return {
    oldStart: first.oldLinesBefore + (oldLines === 0 ? 0 : 1),
    oldLines,
    newStart: first.newLinesBefore + (newLines === 0 ? 0 : 1),
    newLines,
    lines: selected.map(publicLine)
  };
}

function buildHunks(lines: NumberedDiffLine[], contextLines: number): AgentTextDiffHunk[] {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.type === "context") {
      continue;
    }
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length, index + contextLines + 1);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges.map(({ start, end }) => hunkFromRange(lines, start, end));
}

function countHunkLines(hunks: AgentTextDiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

function slicePublicHunk(
  hunk: AgentTextDiffHunk,
  start: number,
  end: number
): AgentTextDiffHunk {
  const lines = hunk.lines.slice(start, end);
  let oldLinesBefore = hunk.oldStart - (hunk.oldLines === 0 ? 0 : 1);
  let newLinesBefore = hunk.newStart - (hunk.newLines === 0 ? 0 : 1);
  for (const line of hunk.lines.slice(0, start)) {
    if (line.type !== "addition") oldLinesBefore += 1;
    if (line.type !== "deletion") newLinesBefore += 1;
  }
  const oldLines = lines.filter((line) => line.type !== "addition").length;
  const newLines = lines.filter((line) => line.type !== "deletion").length;
  return {
    oldStart: oldLinesBefore + (oldLines === 0 ? 0 : 1),
    oldLines,
    newStart: newLinesBefore + (newLines === 0 ? 0 : 1),
    newLines,
    lines
  };
}

function representativeLineIndex(hunk: AgentTextDiffHunk): number {
  const changed = hunk.lines.findIndex((line) => line.type !== "context");
  return changed < 0 ? 0 : changed;
}

function sampleHunk(hunk: AgentTextDiffHunk, quota: number): AgentTextDiffHunk[] {
  if (hunk.lines.length <= quota) {
    return [hunk];
  }
  const changedIndices = hunk.lines.flatMap((line, index) =>
    line.type === "context" ? [] : [index]
  );
  const selected = new Set<number>();
  if (changedIndices.length >= quota) {
    if (quota === 1) {
      selected.add(changedIndices[0]!);
    } else {
      for (let slot = 0; slot < quota; slot += 1) {
        selected.add(
          changedIndices[Math.round((slot * (changedIndices.length - 1)) / (quota - 1))]!
        );
      }
    }
  } else {
    changedIndices.forEach((index) => selected.add(index));
    const contextIndices = hunk.lines
      .flatMap((line, index) => (line.type === "context" ? [index] : []))
      .sort((left, right) => {
        const leftDistance = Math.min(...changedIndices.map((index) => Math.abs(index - left)));
        const rightDistance = Math.min(...changedIndices.map((index) => Math.abs(index - right)));
        return leftDistance - rightDistance || left - right;
      });
    for (const index of contextIndices) {
      if (selected.size >= quota) break;
      selected.add(index);
    }
  }

  const sorted = [...selected].sort((left, right) => left - right);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of sorted) {
    const previous = ranges.at(-1);
    if (previous && previous.end === index) {
      previous.end += 1;
    } else {
      ranges.push({ start: index, end: index + 1 });
    }
  }
  return ranges.map(({ start, end }) => slicePublicHunk(hunk, start, end));
}

/** Keeps output bounded while sampling changes across large hunks. */
function limitHunks(
  hunks: AgentTextDiffHunk[],
  maxRenderedLines: number
): { hunks: AgentTextDiffHunk[]; truncated: boolean } {
  if (countHunkLines(hunks) <= maxRenderedLines) {
    return { hunks, truncated: false };
  }

  if (hunks.length > maxRenderedLines) {
    const selected: AgentTextDiffHunk[] = [];
    const denominator = Math.max(1, maxRenderedLines - 1);
    const seen = new Set<number>();
    for (let slot = 0; slot < maxRenderedLines; slot += 1) {
      const index = Math.round((slot * (hunks.length - 1)) / denominator);
      if (seen.has(index)) continue;
      seen.add(index);
      const hunk = hunks[index]!;
      const lineIndex = representativeLineIndex(hunk);
      selected.push(slicePublicHunk(hunk, lineIndex, lineIndex + 1));
    }
    return { hunks: selected, truncated: true };
  }

  const baseQuota = Math.floor(maxRenderedLines / hunks.length);
  let remainder = maxRenderedLines % hunks.length;
  const limited: AgentTextDiffHunk[] = [];
  for (const hunk of hunks) {
    const quota = baseQuota + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    if (hunk.lines.length <= quota) {
      limited.push(hunk);
      continue;
    }
    limited.push(...sampleHunk(hunk, quota));
  }
  return { hunks: limited, truncated: true };
}

function buildCoarseDiff(
  before: string[],
  after: string[],
  prefixLength: number,
  suffixLength: number,
  contextLines: number,
  maxRenderedLines: number
): AgentTextDiffResult {
  const beforeMiddleLength = before.length - prefixLength - suffixLength;
  const afterMiddleLength = after.length - prefixLength - suffixLength;
  const contextBeforeStart = Math.max(0, prefixLength - contextLines);
  const contextBefore = before.slice(contextBeforeStart, prefixLength);
  const contextAfter = before.slice(
    before.length - suffixLength,
    before.length - suffixLength + Math.min(contextLines, suffixLength)
  );
  const operations: DiffOperation[] = [
    ...contextBefore.map((text) => ({ type: "context" as const, text })),
    ...before
      .slice(prefixLength, before.length - suffixLength)
      .map((text) => ({ type: "deletion" as const, text })),
    ...after
      .slice(prefixLength, after.length - suffixLength)
      .map((text) => ({ type: "addition" as const, text })),
    ...contextAfter.map((text) => ({ type: "context" as const, text }))
  ];
  const numbered = numberOperations(operations, contextBeforeStart, contextBeforeStart);
  const hunks = numbered.length ? [hunkFromRange(numbered, 0, numbered.length)] : [];
  const limited = limitHunks(hunks, maxRenderedLines);
  return {
    additions: afterMiddleLength,
    deletions: beforeMiddleLength,
    hunks: limited.hunks,
    // The fallback is deliberately non-minimal, so disclose that even when its
    // rendered replacement happens to fit within the display budget.
    truncated: true
  };
}

export function buildAgentTextDiff(
  beforeText: string,
  afterText: string,
  options: AgentTextDiffOptions = {}
): AgentTextDiffResult {
  if (beforeText === afterText) {
    return { additions: 0, deletions: 0, hunks: [], truncated: false };
  }

  const contextLines = normalizeLimit(options.contextLines, DEFAULT_CONTEXT_LINES, 0);
  const maxRenderedLines = normalizeLimit(
    options.maxRenderedLines,
    DEFAULT_MAX_RENDERED_LINES,
    1
  );
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  let prefixLength = 0;
  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength &&
    suffixLength < after.length - prefixLength &&
    before[before.length - suffixLength - 1] === after[after.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const beforeMiddle = before.slice(prefixLength, before.length - suffixLength);
  const afterMiddle = after.slice(prefixLength, after.length - suffixLength);
  const middleOperations = buildMyersOperations(beforeMiddle, afterMiddle);
  if (!middleOperations) {
    return buildCoarseDiff(
      before,
      after,
      prefixLength,
      suffixLength,
      contextLines,
      maxRenderedLines
    );
  }

  const contextBeforeStart = Math.max(0, prefixLength - contextLines);
  const leadingContext: DiffOperation[] = before
    .slice(contextBeforeStart, prefixLength)
    .map((text) => ({ type: "context", text }));
  const trailingContext: DiffOperation[] = before
    .slice(before.length - suffixLength, before.length - suffixLength + contextLines)
    .map((text) => ({ type: "context", text }));
  const numbered = numberOperations(
    [...leadingContext, ...middleOperations, ...trailingContext],
    contextBeforeStart,
    contextBeforeStart
  );
  const additions = middleOperations.filter((operation) => operation.type === "addition").length;
  const deletions = middleOperations.filter((operation) => operation.type === "deletion").length;
  const limited = limitHunks(buildHunks(numbered, contextLines), maxRenderedLines);
  return {
    additions,
    deletions,
    hunks: limited.hunks,
    truncated: limited.truncated
  };
}
