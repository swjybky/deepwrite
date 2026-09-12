import type {
  AgentTextDiffHunk,
  AgentTextDiffLine
} from "../../types/conversation";
import { isRecord, nonnegativeInteger } from "./shared";
export function parseStoredTextDiffLine(
  value: unknown
): AgentTextDiffLine | undefined {
  if (
    !isRecord(value) ||
    !["context", "addition", "deletion"].includes(String(value.type)) ||
    typeof value.text !== "string" ||
    (value.oldLineNumber !== undefined &&
      !nonnegativeInteger(value.oldLineNumber)) ||
    (value.newLineNumber !== undefined &&
      !nonnegativeInteger(value.newLineNumber))
  ) {
    return undefined;
  }
  return {
    type: value.type as AgentTextDiffLine["type"],
    text: value.text,
    ...(value.oldLineNumber === undefined
      ? {}
      : { oldLineNumber: value.oldLineNumber as number }),
    ...(value.newLineNumber === undefined
      ? {}
      : { newLineNumber: value.newLineNumber as number })
  };
}
export function parseStoredTextDiffHunk(
  value: unknown
): AgentTextDiffHunk | undefined {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.oldStart) ||
    !nonnegativeInteger(value.oldLines) ||
    !nonnegativeInteger(value.newStart) ||
    !nonnegativeInteger(value.newLines) ||
    !Array.isArray(value.lines)
  ) {
    return undefined;
  }
  const lines = value.lines
    .map(parseStoredTextDiffLine)
    .filter((line): line is AgentTextDiffLine => line !== undefined);
  if (lines.length !== value.lines.length) return undefined;
  return {
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    lines
  };
}
