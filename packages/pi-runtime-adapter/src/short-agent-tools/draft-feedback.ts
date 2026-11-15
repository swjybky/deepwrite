import { countWritingContentCharacters } from "../writing-content-counts";
import type { BuildWritingWorkspaceToolsInput } from "./shared";

const UNIT = String.raw`\s*(?:字|characters?|chars?)?\s*`;
const RANGE = new RegExp(
  String.raw`^(\d+)\s*[-–—~～至到]\s*(\d+)${UNIT}$`,
  "iu"
);
const UPPER = new RegExp(
  String.raw`^(?:(?:不超过|不多于|最多|至多|上限|≤|<=)\s*(\d+)${UNIT}(?:以内|之内|以下)?|(\d+)${UNIT}(?:以内|之内|以下))$`,
  "iu"
);
const LOWER = new RegExp(
  String.raw`^(?:(?:不少于|不低于|至少|最少|下限|≥|>=)\s*(\d+)${UNIT}(?:以上)?|(\d+)${UNIT}以上)$`,
  "iu"
);
const EXACT = new RegExp(String.raw`^(\d+)${UNIT}$`, "iu");

function lengthBounds(requirement: string): [number, number] | undefined {
  const text = requirement.trim();
  const range = RANGE.exec(text);
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])];
    return low <= high ? [low, high] : undefined;
  }
  const upper = UPPER.exec(text);
  if (upper) return [0, Number(upper[1] ?? upper[2])];
  const lower = LOWER.exec(text);
  if (lower) return [Number(lower[1] ?? lower[2]), Infinity];
  const exact = EXACT.exec(text);
  return exact ? [Number(exact[1]), Number(exact[1])] : undefined;
}

export function draftBodyFeedback(
  input: BuildWritingWorkspaceToolsInput,
  body: string,
  requirement: string
): string {
  const english = input.promptLocale === "en-US";
  const lines: string[] = [];
  if (requirement) {
    const actual = countWritingContentCharacters(body);
    const bounds = lengthBounds(requirement);
    let comparison = "";
    if (bounds) {
      const [low, high] = bounds;
      comparison =
        actual < low
          ? english
            ? `below target by ${low - actual}`
            : `低于要求，少 ${low - actual} 字`
          : actual > high
            ? english
              ? `above target by ${actual - high}`
              : `高于要求，超出 ${actual - high} 字`
            : english
              ? "within target"
              : "符合要求";
    }
    lines.push(
      english
        ? `Length target: ${requirement} (actual: ${actual} characters${comparison ? ", " + comparison : ""})`
        : `篇幅要求：${requirement}（正文 ${actual} 字${comparison ? "，" + comparison : ""}）`
    );
  }
  if (input.workspaceType === "script" && body.trim()) {
    if (
      !/^\s*\d+[.．、]\s*(?:内景|外景|INT\.|EXT\.)\s*\S[^\n]*\s[-–—]\s*\S/imu.test(
        body
      )
    )
      lines.push(
        english
          ? "Format note: check the numbered scene heading, location and time."
          : "格式提示：请检查场景标题的序号、内外景、地点和时间。"
      );
    if (/^\s*(?:#{1,6}\s+|\|?\s*:?-{3,}:?\s*\|\s*:?-{3,})/mu.test(body))
      lines.push(
        english
          ? "Format note: check for Markdown headings or tables in the screenplay body."
          : "格式提示：请检查剧本正文中的 Markdown 标题或表格。"
      );
  }
  return lines.join("\n");
}
