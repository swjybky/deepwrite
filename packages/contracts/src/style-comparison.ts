import { z } from "zod";

export const STYLE_COMPARISON_TEXT_LIMIT = 30_000;
export const STYLE_COMPARISON_METHOD_LIMIT = 8_000;
export const DEFAULT_STYLE_COMPARISON_METHOD = [
  "请从措辞与用词、句式与节奏、叙述视角、描写与修辞、情绪与语气五个维度比较。",
  "关注表达习惯，不因题材、人物名或情节相同就判定文风相近。结合两份文本中的短句举证，概括最明显的共性与差异。",
  "各维度同等重要。样本较短或体裁差异较大时，在结论中说明判断依据的局限。"
].join("\n");

export const StyleComparisonInputSchema = z.object({
  referenceText: z.string().trim().min(1).max(STYLE_COMPARISON_TEXT_LIMIT),
  comparisonText: z.string().trim().min(1).max(STYLE_COMPARISON_TEXT_LIMIT),
  method: z.string().trim().max(STYLE_COMPARISON_METHOD_LIMIT)
});
export type StyleComparisonInput = z.infer<typeof StyleComparisonInputSchema>;

export const StyleComparisonDimensionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  score: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(600)
});
export type StyleComparisonDimension = z.infer<
  typeof StyleComparisonDimensionSchema
>;

export const StyleComparisonResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(1).max(800),
  dimensions: z.array(StyleComparisonDimensionSchema).min(3).max(6),
  similarities: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
  differences: z.array(z.string().trim().min(1).max(400)).min(1).max(3)
});
export type StyleComparisonResult = z.infer<typeof StyleComparisonResultSchema>;
