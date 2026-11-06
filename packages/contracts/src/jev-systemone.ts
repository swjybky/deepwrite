import { z } from "zod";

/** Stable Chinese rubric for draw-candidate quality (low → high). Score ∈ [0, length-1]. */
export const DRAW_JEV_SCORE_CRITERIA = [
  "不合格：偏离任务、遗漏硬性要求，或明显未完成",
  "勉强：与任务相关，但缺口或错误较多",
  "合格：满足硬性要求，完成度可接受",
  "良好：完成度与内容质量较好，表达通顺",
  "优秀：完成度、质量与文风都突出，问题最少"
] as const;

export const DRAW_JEV_SCORE_QUESTION_ID = "candidate_quality";

export const DRAW_JEV_SCORE_INSTRUCTIONS =
  "请根据原任务要求，评价这份候选结果的整体质量。先核对是否满足硬性约束（格式、字数、视角、必须包含或不得出现的内容），再比较完成度、内容质量与文字表达；几份都不理想时，给问题相对最少的一份更高分。";

export const JEV_SYSTEMONE_TIMEOUT_MS = 60_000;
export const JEV_SYSTEMONE_MAX_ATTEMPTS = 2;

export const JevSystemOneScoreQuestionSchema = z
  .object({
    type: z.literal("score"),
    instructions: z.union([
      z.string().min(1),
      z.record(z.string(), z.unknown()),
      z.array(z.unknown())
    ]),
    criteria: z.array(z.string().min(1)).min(2).max(10)
  })
  .strict();

export const JevSystemOneRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(240),
    state: z.union([
      z.string().min(1),
      z.record(z.string(), z.unknown()),
      z.array(z.unknown())
    ]),
    questions: z
      .record(z.string(), JevSystemOneScoreQuestionSchema)
      .refine((value) => Object.keys(value).length > 0, {
        message: "At least one question is required."
      })
  })
  .strict();
export type JevSystemOneRequest = z.infer<typeof JevSystemOneRequestSchema>;

export const JevSystemOneScoreAnswerSchema = z
  .object({
    type: z.literal("score"),
    score: z.number().finite(),
    confidence: z.number().finite().optional(),
    legend: z.record(z.string(), z.unknown()).optional(),
    probabilities: z.record(z.string(), z.number().finite()).optional()
  })
  .passthrough();
export type JevSystemOneScoreAnswer = z.infer<
  typeof JevSystemOneScoreAnswerSchema
>;

export const JevSystemOneResponseSchema = z
  .object({
    model: z.string().optional(),
    answers: z.record(z.string(), z.unknown()),
    usage: z
      .object({
        input_tokens: z.number().finite().optional(),
        output_tokens: z.number().finite().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();
export type JevSystemOneResponse = z.infer<typeof JevSystemOneResponseSchema>;

/**
 * Builds the SystemOne URL from a model baseUrl.
 * Accepts roots, `/v1`, or a base already pointing at `/v1/systemone`.
 */
export function resolveJevSystemOneUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    throw new Error("JEV 模型未配置 API 地址。");
  }
  if (/\/v1\/systemone$/iu.test(trimmed)) return trimmed;
  if (/\/systemone$/iu.test(trimmed)) return trimmed;
  if (/\/v1$/iu.test(trimmed)) return `${trimmed}/systemone`;
  return `${trimmed}/v1/systemone`;
}

export function parseJevSystemOneScoreAnswer(
  response: unknown,
  questionId: string,
  criteriaLength: number
): JevSystemOneScoreAnswer {
  const parsed = JevSystemOneResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("JEV 响应格式无效。");
  }
  const raw = parsed.data.answers[questionId];
  const answer = JevSystemOneScoreAnswerSchema.safeParse(raw);
  if (!answer.success) {
    throw new Error(`JEV 未返回有效的 score 答案（${questionId}）。`);
  }
  const max = Math.max(0, criteriaLength - 1);
  if (answer.data.score < 0 || answer.data.score > max) {
    throw new Error(`JEV 分数 ${answer.data.score} 超出合法区间 0–${max}。`);
  }
  return answer.data;
}

export function buildDrawJevScoreQuestion(instructions: string): {
  type: "score";
  instructions: string;
  criteria: string[];
} {
  return {
    type: "score",
    instructions,
    criteria: [...DRAW_JEV_SCORE_CRITERIA]
  };
}

export function buildDrawJevScoreInstructions(
  evaluationRules: string | undefined
): string {
  const rules = evaluationRules?.trim();
  if (!rules) return DRAW_JEV_SCORE_INSTRUCTIONS;
  return `${DRAW_JEV_SCORE_INSTRUCTIONS}\n\n【补充评估规则】\n${rules}`;
}
