import { z } from "zod";

export const STYLE_COMPARISON_TEXT_LIMIT = 30_000;
export const STYLE_COMPARISON_METHOD_LIMIT = 8_000;

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
