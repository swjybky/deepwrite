import {
  StyleComparisonDimensionSchema,
  StyleComparisonResultSchema,
  type StyleComparisonDimension,
  type StyleComparisonResult
} from "@deepwrite/contracts/renderer";

export function parseStyleComparisonResult(
  text: string
): StyleComparisonResult {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return StyleComparisonResultSchema.parse(JSON.parse(body));
  } catch {
    throw new Error("模型未返回完整的比对结论与有效评分，请重新比对。");
  }
}

// Show only complete public findings while JSON is streaming. Never infer a
// final score from partial output or display the raw JSON / thinking events.
export function styleComparisonPreview(text: string): {
  summary: string;
  dimensions: StyleComparisonDimension[];
} {
  const summaryMatch = /"summary"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
  let summary = "";
  try {
    summary = summaryMatch ? String(JSON.parse(summaryMatch[1]!)) : "";
  } catch {
    /* Incomplete stream. */
  }
  const dimensions: StyleComparisonDimension[] = [];
  for (const match of text.matchAll(/\{(?:[^{}"\\]|"(?:[^"\\]|\\.)*")*\}/g)) {
    try {
      const parsed = StyleComparisonDimensionSchema.safeParse(
        JSON.parse(match[0])
      );
      if (parsed.success && dimensions.length < 6) dimensions.push(parsed.data);
    } catch {
      /* Incomplete stream. */
    }
  }
  return { summary: summary.slice(0, 800), dimensions };
}

export function similarityLabel(score: number): string {
  if (score >= 80) return "高度相似";
  if (score >= 60) return "较为相似";
  if (score >= 40) return "部分相似";
  if (score >= 20) return "差异明显";
  return "风格差异极大";
}
