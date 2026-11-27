import { LongFileIdSchema } from "@deepwrite/contracts";
import {
  characterOffsetAtCodeUnit,
  codeUnitOffsetAtCharacter,
  countUnicodeCodePoints,
  sliceIndexedUnicodeCodePointRange
} from "./cache";
import { nonnegativeInteger } from "./io";
import type {
  CachedPagedTextFile,
  LoadedPagedIndexedFile,
  LongProjectSearchMatch,
  LongProjectSearchResume
} from "./types";
import { escapeRegExp } from "@deepwrite/shared";

export interface ScannedSearchFile {
  fileId: string;
  characterLength: number;
  scannedCharacters: number;
  matches: LongProjectSearchMatch[];
  nextMatchOffset: number | null;
}

export interface NormalizedSearchSegment {
  normalizedStart: number;
  normalizedEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export function parseProjectSearchResume(
  raw: LongProjectSearchResume | undefined,
  fileIds: readonly string[]
): LongProjectSearchResume | undefined {
  if (raw === undefined) return undefined;
  const fileIndex = nonnegativeInteger(raw.fileIndex, "搜索游标文件位置");
  const characterOffset = nonnegativeInteger(
    raw.characterOffset,
    "搜索游标字符位置"
  );
  const fileId = LongFileIdSchema.parse(raw.fileId);
  if (fileIndex >= fileIds.length || fileIds[fileIndex] !== fileId) {
    throw new Error("长篇搜索游标与当前文件顺序不一致。");
  }
  return { fileIndex, fileId, characterOffset };
}

export async function scanIndexedFileForSearch(
  file: LoadedPagedIndexedFile,
  query: string,
  characterOffset: number,
  maxMatches: number,
  contextCharacters: number,
  characterBudget: number
): Promise<ScannedSearchFile> {
  const { disk, paging } = file;
  const startCharacterOffset = Math.min(
    characterOffset,
    paging.totalCharacters
  );

  const normalizedWindow = createNormalizedSearchWindow(
    paging,
    startCharacterOffset,
    Math.max(1, characterBudget),
    query
  );
  const matcher = new RegExp(escapeRegExp(query), "giu");
  const matches: LongProjectSearchMatch[] = [];
  const seenRanges = new Set<string>();
  while (true) {
    const match = matcher.exec(normalizedWindow.normalized);
    if (!match) {
      return {
        fileId: file.reference.id,
        characterLength: paging.totalCharacters,
        scannedCharacters:
          normalizedWindow.scanEndCharacterOffset - startCharacterOffset,
        matches,
        nextMatchOffset:
          normalizedWindow.scanEndCharacterOffset < paging.totalCharacters
            ? normalizedWindow.scanEndCharacterOffset
            : null
      };
    }
    const sourceRange = normalizedWindow.directNfc
      ? {
          start: characterOffsetAtCodeUnit(
            paging,
            normalizedWindow.sourceStartCodeUnit + match.index
          ),
          end: characterOffsetAtCodeUnit(
            paging,
            normalizedWindow.sourceStartCodeUnit + match.index + match[0].length
          )
        }
      : normalizedMatchSourceRange(
          normalizedWindow.segments,
          match.index,
          match.index + match[0].length
        );
    if (
      !sourceRange ||
      sourceRange.start >= normalizedWindow.scanEndCharacterOffset
    ) {
      continue;
    }
    const rangeKey = `${sourceRange.start}:${sourceRange.end}`;
    if (seenRanges.has(rangeKey)) continue;
    if (matches.length >= maxMatches) {
      return {
        fileId: file.reference.id,
        characterLength: paging.totalCharacters,
        scannedCharacters: Math.max(
          1,
          sourceRange.start - startCharacterOffset
        ),
        matches,
        nextMatchOffset: sourceRange.start
      };
    }
    seenRanges.add(rangeKey);
    const sourceStartCodeUnit = codeUnitOffsetAtCharacter(
      paging,
      sourceRange.start
    );
    matches.push({
      fileId: file.reference.id,
      path: file.reference.path,
      offset: sourceRange.start,
      endOffset: sourceRange.end,
      line: 1 + countNewlines(disk.content, 0, sourceStartCodeUnit),
      preview: sliceIndexedUnicodeCodePointRange(
        paging,
        Math.max(0, sourceRange.start - contextCharacters),
        Math.min(paging.totalCharacters, sourceRange.end + contextCharacters)
      )
    });
  }
}

export function createNormalizedSearchWindow(
  paging: CachedPagedTextFile,
  characterOffset: number,
  characterBudget: number,
  query: string
): {
  normalized: string;
  segments: NormalizedSearchSegment[];
  scanEndCharacterOffset: number;
  directNfc: boolean;
  sourceStartCodeUnit: number;
} {
  const targetScanEnd = Math.min(
    paging.totalCharacters,
    characterOffset + characterBudget
  );
  const overlap = Math.max(32, countUnicodeCodePoints(query) + 8);
  const sourceEnd = Math.min(paging.totalCharacters, targetScanEnd + overlap);
  const source = sliceIndexedUnicodeCodePointRange(
    paging,
    characterOffset,
    sourceEnd
  );
  const sourceStartCodeUnit = codeUnitOffsetAtCharacter(
    paging,
    characterOffset
  );
  if (source.normalize("NFC") === source) {
    return {
      normalized: source,
      segments: [],
      scanEndCharacterOffset: targetScanEnd,
      directNfc: true,
      sourceStartCodeUnit
    };
  }
  const segmenter = new Intl.Segmenter("und", {
    granularity: "grapheme"
  });
  const normalizedParts: string[] = [];
  const segments: NormalizedSearchSegment[] = [];
  let normalizedLength = 0;
  let sourceCharacterCursor = characterOffset;
  let scanEndCharacterOffset = targetScanEnd;
  for (const segment of segmenter.segment(source)) {
    const sourceCharacters = countUnicodeCodePoints(segment.segment);
    const sourceStart = sourceCharacterCursor;
    const sourceEndOffset = sourceStart + sourceCharacters;
    const normalized = segment.segment.normalize("NFC");
    normalizedParts.push(normalized);
    segments.push({
      normalizedStart: normalizedLength,
      normalizedEnd: normalizedLength + normalized.length,
      sourceStart,
      sourceEnd: sourceEndOffset
    });
    normalizedLength += normalized.length;
    sourceCharacterCursor = sourceEndOffset;
    if (sourceStart < targetScanEnd && sourceEndOffset >= targetScanEnd) {
      scanEndCharacterOffset = sourceEndOffset;
    }
  }
  return {
    normalized: normalizedParts.join(""),
    segments,
    scanEndCharacterOffset: Math.min(
      scanEndCharacterOffset,
      paging.totalCharacters
    ),
    directNfc: false,
    sourceStartCodeUnit
  };
}

export function normalizedMatchSourceRange(
  segments: readonly NormalizedSearchSegment[],
  normalizedStart: number,
  normalizedEnd: number
): { start: number; end: number } | null {
  const first = segments.find(
    (segment) =>
      segment.normalizedEnd > normalizedStart &&
      segment.normalizedStart < normalizedEnd
  );
  if (!first) return null;
  let last = first;
  for (const segment of segments) {
    if (segment.normalizedStart >= normalizedEnd) break;
    if (segment.normalizedEnd > normalizedStart) last = segment;
  }
  return { start: first.sourceStart, end: last.sourceEnd };
}

export function countNewlines(
  text: string,
  start: number,
  end: number
): number {
  let count = 0;
  let cursor = text.indexOf("\n", start);
  while (cursor >= 0 && cursor < end) {
    count += 1;
    cursor = text.indexOf("\n", cursor + 1);
  }
  return count;
}
