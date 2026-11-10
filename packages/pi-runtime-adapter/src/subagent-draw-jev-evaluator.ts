import {
  DRAW_JEV_SCORE_CRITERIA,
  DRAW_JEV_SCORE_QUESTION_ID,
  buildDrawJevScoreInstructions,
  buildDrawJevScoreQuestion,
  JEV_STATE_CHAR_BUDGET,
  JEV_STATE_TASK_CHAR_BUDGET,
  resolveDrawEvaluationMethod,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import { scoreWithJevSystemOne } from "./jev-systemone-client";
import {
  DRAW_EVALUATOR_NAME,
  type DrawCandidate,
  type DrawEvaluation,
  type DrawEvaluatorContext
} from "./subagent-draw-evaluator";
import { createSubagentRunId, emitter } from "./subagent-child";
import { subagentModelRuntime } from "./subagent-model";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";

export interface DrawJevCandidateScore {
  number: number;
  score?: number;
  confidence?: number;
  error?: string;
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}

function scoreLine(entry: DrawJevCandidateScore): string {
  if (entry.error) return `第 ${entry.number} 份失败：${entry.error}`;
  if (entry.score === undefined) return `第 ${entry.number} 份无有效分`;
  const confidence =
    entry.confidence === undefined
      ? ""
      : `，置信度 ${formatScore(entry.confidence)}`;
  return `第 ${entry.number} 份 ${formatScore(entry.score)}${confidence}`;
}

export function summarizeDrawJevScores(
  scores: readonly DrawJevCandidateScore[]
): string {
  return scores.map(scoreLine).join("；");
}

export function pickHighestDrawJevScore(
  candidates: readonly DrawCandidate[],
  scores: readonly DrawJevCandidateScore[]
):
  | {
      status: "selected";
      candidate: DrawCandidate;
      score: number;
      reason: string;
    }
  | { status: "failed"; reason: string } {
  const valid = scores
    .filter(
      (entry): entry is DrawJevCandidateScore & { score: number } =>
        entry.score !== undefined && !entry.error
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.number - right.number;
    });
  if (valid.length === 0) {
    return {
      status: "failed",
      reason: `JEV 模型评估没有有效分数：${summarizeDrawJevScores(scores)}`
    };
  }
  const best = valid[0]!;
  const candidate = candidates.find((item) => item.number === best.number);
  if (!candidate) {
    return {
      status: "failed",
      reason: `JEV 选中的候选 ${best.number} 已不存在。`
    };
  }
  const tied = valid.filter((entry) => entry.score === best.score);
  const tieNote =
    tied.length > 1 ? "同分时取候选编号更小。" : "同一评分标准下分数越高越好。";
  return {
    status: "selected",
    candidate,
    score: best.score,
    reason: [
      `JEV 选中第 ${candidate.number} 份（得分 ${formatScore(best.score)}）。`,
      `各份得分：${summarizeDrawJevScores(scores)}。`,
      tieNote
    ].join(" ")
  };
}

function resolveJevRuntimeConfig(
  input: BuildSpawnSubagentToolInput,
  modelId: string
): AgentProviderRuntimeConfig {
  const config = input.subagentRuntimeConfigs?.[modelId];
  if (!config) {
    throw new Error(
      `${DRAW_EVALUATOR_NAME}配置的 JEV 模型不可用，请重新保存智能体团队或在自定义模型中配置 JEV。`
    );
  }
  if (!config.apiKey.trim()) {
    throw new Error(`${DRAW_EVALUATOR_NAME}的 JEV 模型未配置 API Key。`);
  }
  if (!config.baseUrl.trim()) {
    throw new Error(`${DRAW_EVALUATOR_NAME}的 JEV 模型未配置 API 地址。`);
  }
  return config;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Builds one scoring state that stays under Jev's per-question limit
 * (state + question ≤ 32k tokens). The task is capped first so a long brief
 * cannot crowd out the candidate being judged.
 */
export function candidateState(task: string, candidate: DrawCandidate): string {
  const taskText = clip(task, JEV_STATE_TASK_CHAR_BUDGET);
  const header = `【候选 ${candidate.number}${candidate.variant ? `｜侧重：${candidate.variant}` : ""}】`;
  const budget = Math.max(
    1,
    JEV_STATE_CHAR_BUDGET - taskText.length - header.length - 64
  );
  const truncated = candidate.summary.length > budget;
  return [
    "【原任务】",
    taskText,
    "",
    `${header}${truncated ? `（已截断，原文共 ${candidate.summary.length} 字）` : ""}`,
    clip(candidate.summary, budget)
  ].join("\n");
}

/**
 * Scores each completed candidate with the same configured JEV SystemOne
 * endpoint and picks the highest valid score. Never falls back to the LLM
 * evaluator; callers hand failures to manual selection.
 */
export async function runDrawJevEvaluator(
  input: BuildSpawnSubagentToolInput,
  context: DrawEvaluatorContext
): Promise<DrawEvaluation> {
  const { request, settings, candidates, signal } = context;
  const evaluator = settings.evaluator;
  if (resolveDrawEvaluationMethod(evaluator) !== "jev") {
    return { status: "failed", reason: "当前不是 JEV 模型评估。" };
  }
  const modelId = evaluator.modelId?.trim();
  if (!modelId) {
    return {
      status: "failed",
      reason: "JEV 模型评估未选择模型。"
    };
  }

  const base = {
    parentToolCallId: context.parentToolCallId,
    subagentRunId: createSubagentRunId(input),
    subagentId: request.definition.id,
    name: DRAW_EVALUATOR_NAME,
    runtime: subagentModelRuntime(input, {
      modelMode: "custom",
      modelId
    }),
    ...(context.batchTask ? { batchTask: context.batchTask } : {}),
    draw: { role: "evaluator" as const, count: context.count }
  };
  const emitProgress = emitter(context);
  emitProgress(
    {
      ...base,
      type: "started",
      task: `用 JEV 为「${request.definition.name}」的 ${candidates.length} 份候选打分。`
    },
    `${DRAW_EVALUATOR_NAME}已开始 JEV 评分。`
  );

  let config: AgentProviderRuntimeConfig;
  try {
    config = resolveJevRuntimeConfig(input, modelId);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    emitProgress(
      {
        ...base,
        type: "completed",
        status: signal?.aborted ? "aborted" : "error",
        summary: `${DRAW_EVALUATOR_NAME}执行失败：${reason}`,
        errorMessage: reason.slice(0, 4_000)
      },
      reason
    );
    return { status: "failed", reason };
  }

  const instructions = buildDrawJevScoreInstructions(evaluator.prompt);
  const question = buildDrawJevScoreQuestion(instructions);
  const scores: DrawJevCandidateScore[] = [];

  for (const candidate of candidates) {
    if (signal?.aborted) {
      const reason = "JEV 评分已取消。";
      emitProgress(
        {
          ...base,
          type: "completed",
          status: "aborted",
          summary: reason
        },
        reason
      );
      return { status: "failed", reason };
    }
    context.onProgress?.(`正在评分第 ${candidate.number} 份候选…`);
    try {
      const answer = await scoreWithJevSystemOne({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        questionId: DRAW_JEV_SCORE_QUESTION_ID,
        criteriaLength: DRAW_JEV_SCORE_CRITERIA.length,
        ...(signal ? { signal } : {}),
        request: {
          model: config.modelId,
          state: candidateState(request.task, candidate),
          questions: {
            [DRAW_JEV_SCORE_QUESTION_ID]: question
          }
        }
      });
      scores.push({
        number: candidate.number,
        score: answer.score,
        ...(answer.confidence !== undefined
          ? { confidence: answer.confidence }
          : {})
      });
    } catch (error: unknown) {
      if (signal?.aborted) {
        return { status: "failed", reason: "JEV 评分已取消。" };
      }
      scores.push({
        number: candidate.number,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    context.onProgress?.(`JEV 评分进度：${summarizeDrawJevScores(scores)}`);
  }

  const picked = pickHighestDrawJevScore(candidates, scores);
  if (picked.status === "failed") {
    emitProgress(
      {
        ...base,
        type: "completed",
        status: "error",
        summary: picked.reason,
        errorMessage: picked.reason.slice(0, 4_000)
      },
      picked.reason
    );
    return picked;
  }

  emitProgress(
    {
      ...base,
      type: "completed",
      status: "completed",
      summary: picked.reason
    },
    picked.reason
  );
  return {
    status: "selected",
    candidate: picked.candidate,
    reason: picked.reason
  };
}
