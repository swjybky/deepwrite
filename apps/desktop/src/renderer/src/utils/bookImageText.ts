import { parseBookImageLine } from "@deepwrite/contracts/renderer";
import { countNonWhitespaceCharacters } from "./boundedTextHistory";

/** Keep the shared history counter literal; only document totals omit images. */
export function countDocumentCharacters(content: string): number {
  if (!content.includes("![")) return countNonWhitespaceCharacters(content);
  let count = 0;
  for (const line of content.split(/\r?\n/u)) {
    if (!parseBookImageLine(line)) count += countNonWhitespaceCharacters(line);
  }
  return count;
}
