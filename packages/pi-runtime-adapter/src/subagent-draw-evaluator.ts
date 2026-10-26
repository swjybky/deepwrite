import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Api, type Model, type Static } from "@earendil-works/pi-ai";
import {
  DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT,
  type SubagentDrawSettings
} from "@deepwrite/contracts";
import { piStrictToolSampling } from "./pi-tool-schema";
import { createSubagentRunId, emitter } from "./subagent-child";
import { isAssistantMessage, textResult } from "./subagent-helpers";
import { runSubagentLifecycle } from "./subagent-lifecycle";
import {
  resolveSubagentModel,
  subagentModelRuntime,
  withoutProviderRetries
} from "./subagent-model";
import type {
  BuildSpawnSubagentToolInput,
  SubagentBatchTaskRef,
  SubagentProgressBase,
  SubagentTaskRequest,
  SubagentToolDetails
} from "./subagent-types";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";

export const DRAW_EVALUATOR_NAME = "评估助手";
const SELECT_TOOL_NAME = "select_candidate";
const REASON_MAX_LENGTH = 1_000;
const CANDIDATE_TOTAL_MAX_CHARS = 100_000;

/** One successful draw; `number` is its draw position counted from 1. */
export interface DrawCandidate {
  number: number;
  index: number;
  subagentRunId: string;
  summary: string;
  /** The parent's requirement for this draw in auto-count mode. */
  variant?: string;
}

export type DrawEvaluation =
  | { status: "selected"; candidate: DrawCandidate; reason: string }
  | { status: "failed"; reason: string };

export interface DrawEvaluatorContext {
  parentToolCallId: string;
  request: SubagentTaskRequest;
  batchTask?: SubagentBatchTaskRef;
  signal?: AbortSignal;
  onUpdate?: (partialResult: AgentToolResult<SubagentToolDetails>) => void;
  settings: SubagentDrawSettings;
  /** Draws the task ran, failed ones included. */
  count: number;
  candidates: readonly DrawCandidate[];
}

const RUN_BOUNDARY = [
  "【抽卡评估运行边界】",
  "- 你只能看到任务原文和候选结果，看不到作品、素材和主对话。只依据这些内容判断，不要猜测候选之外的信息。",
  `- 你唯一的工具是 ${SELECT_TOOL_NAME}。评估结束时必须调用它一次，提交候选编号和理由；只写文字回复不会被采纳。`,
  "- 不要改写、合并或续写候选，你的工作只是选择。",
  "- 标注“已截断”的候选超出了评估长度，只能依据可见部分判断。"
].join("\n");
// The rules a user edits know nothing of per-draw requirements.
const VARIANT_BOUNDARY =
  "- 候选标注的“侧重”是有意安排的差异方向。以原任务为准判断哪一份最合适：方向本身是否适合任务可以作为比较的一部分，但不要因为候选遵循了自己的侧重就判它偏离任务。";

function hasVariants(candidates: readonly DrawCandidate[]): boolean {
  return candidates.some((candidate) => candidate.variant);
}

/** Splits the evaluator's reading budget evenly between the candidates. */
export function drawCandidateCharBudget(
  model: Pick<Model<Api>, "contextWindow">,
  count: number
): number {
  const window = model.contextWindow > 0 ? model.contextWindow : Infinity;
  const total = Math.min(CANDIDATE_TOTAL_MAX_CHARS, Math.floor(window / 2));
  return Math.max(1, Math.floor(total / Math.max(1, count)));
}

export function drawEvaluatorTaskMessage(
  task: string,
  candidates: readonly DrawCandidate[],
  perCandidateChars: number
): string {
  const numbers = candidates.map((candidate) => candidate.number).join("、");
  return [
    `【评估任务】请从下面 ${candidates.length} 份候选中选出最好的一份。${hasVariants(candidates) ? "各份候选按不同侧重生成，侧重标在候选标题里。" : ""}读完后必须调用 ${SELECT_TOOL_NAME} 提交选择：candidate 填候选编号（${numbers} 之一），reason 写选择理由。调用这个工具是本次评估唯一有效的输出。`,
    "",
    "【原任务】",
    task,
    ...candidates.flatMap((candidate) => {
      const truncated = candidate.summary.length > perCandidateChars;
      return [
        "",
        `【候选 ${candidate.number}${candidate.variant ? `｜侧重：${candidate.variant}` : ""}】${truncated ? `（已截断，原文共 ${candidate.summary.length} 字）` : ""}`,
        truncated
          ? `${candidate.summary.slice(0, perCandidateChars)}…`
          : candidate.summary
      ];
    }),
    "",
    `再次提醒：评估结束时必须调用 ${SELECT_TOOL_NAME}，否则你的判断不会被采纳。`
  ].join("\n");
}

function selectTool(
  candidates: readonly DrawCandidate[],
  record: (candidate: DrawCandidate, reason: string) => boolean
): AgentTool {
  const numbers = candidates.map((candidate) => candidate.number);
  const parameters = Type.Object(
    {
      candidate: Type.Integer({
        minimum: Math.min(...numbers),
        maximum: Math.max(...numbers),
        description: `选中的候选编号：${numbers.join("、")} 之一。`
      }),
      reason: Type.String({
        minLength: 1,
        maxLength: REASON_MAX_LENGTH,
        description: "选择理由：选中的候选胜在哪里，主要缺点是什么。"
      })
    },
    { additionalProperties: false }
  );
  return {
    name: SELECT_TOOL_NAME,
    label: "选择候选",
    description: `提交评估结果：从候选 ${numbers.join("、")} 中选出一份。评估结束时必须调用且只调用一次。`,
    parameters,
    ...piStrictToolSampling(parameters),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const { candidate: number, reason } = params as Static<typeof parameters>;
      const candidate = candidates.find((item) => item.number === number);
      if (!candidate) {
        throw new Error(`候选编号必须是 ${numbers.join("、")} 之一。`);
      }
      const recorded = record(candidate, reason.trim());
      return {
        ...textResult(
          recorded
            ? `已记录：选择候选 ${number}。`
            : "已记录过一次选择，本次调用不生效。",
          { kind: "none" }
        ),
        terminate: true
      };
    }
  };
}

/**
 * Runs the evaluator child of an auto draw. It sees only the task and the
 * candidates, owns a single select tool, and gets one reminder when it ends
 * without calling it; anything short of a selection returns `failed`, and
 * the caller hands the choice to the user.
 */
export async function runDrawEvaluator(
  input: BuildSpawnSubagentToolInput,
  context: DrawEvaluatorContext
): Promise<DrawEvaluation> {
  const { request, settings, count, candidates, signal } = context;
  const evaluator = settings.evaluator;
  const base: SubagentProgressBase = {
    parentToolCallId: context.parentToolCallId,
    subagentRunId: createSubagentRunId(input),
    subagentId: request.definition.id,
    name: DRAW_EVALUATOR_NAME,
    runtime: subagentModelRuntime(input, evaluator),
    ...(context.batchTask ? { batchTask: context.batchTask } : {}),
    draw: { role: "evaluator", count }
  };
  const emitProgress = emitter(context);
  emitProgress(
    {
      ...base,
      type: "started",
      task: `从「${request.definition.name}」的 ${candidates.length} 份候选中选出最好的一份。`
    },
    `${DRAW_EVALUATOR_NAME}已开始评估。`
  );

  let selection: { candidate: DrawCandidate; reason: string } | undefined;
  let child: Agent;
  let taskMessage: string;
  try {
    const resolved = resolveSubagentModel(
      input,
      evaluator,
      `「${request.definition.name}」的${DRAW_EVALUATOR_NAME}`
    );
    taskMessage = drawEvaluatorTaskMessage(
      request.task,
      candidates,
      drawCandidateCharBudget(resolved.model, candidates.length)
    );
    const tools = [
      selectTool(candidates, (candidate, reason) => {
        if (selection) return false;
        selection = { candidate, reason };
        return true;
      })
    ];
    child = new Agent({
      initialState: {
        systemPrompt: [
          (evaluator.prompt ?? DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT).trim(),
          "",
          RUN_BOUNDARY,
          ...(hasVariants(candidates) ? [VARIANT_BOUNDARY] : [])
        ].join("\n"),
        model: resolved.model,
        thinkingLevel: resolved.thinkingLevel,
        messages: [],
        tools
      },
      streamFn: withoutProviderRetries(resolved.streamFn),
      sessionId: `${input.parentSessionId}:${base.subagentRunId}`,
      toolExecution: "sequential"
    });
  } catch (error: unknown) {
    const reason =
      error instanceof Error ? error.message : "评估助手初始化失败。";
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

  let reminded = false;
  const unsubscribe = child.subscribe((event) => {
    if (
      selection ||
      reminded ||
      event.type !== "message_end" ||
      !isAssistantMessage(event.message) ||
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted" ||
      event.message.errorMessage ||
      event.message.content.some((item) => item.type === "toolCall")
    ) {
      return;
    }
    reminded = true;
    child.followUp({
      role: "user",
      content: `你还没有调用 ${SELECT_TOOL_NAME}。评估结果只能通过这个工具提交，请现在调用它：candidate 填候选编号（${candidates.map((candidate) => candidate.number).join("、")} 之一），reason 写理由。`,
      timestamp: Date.now()
    });
  });
  // Ordinary child runs compact long contexts; the evaluator's prompt is
  // already sized to its model, and a summary would blur the candidates.
  const { contextPolicy: _compaction, ...evaluatorInput } = input;
  let outcome;
  try {
    outcome = await runSubagentLifecycle(
      child,
      evaluatorInput,
      base,
      taskMessage,
      base.runtime!,
      emitProgress,
      signal,
      undefined,
      () =>
        selection
          ? `选择候选 ${selection.candidate.number}。理由：${selection.reason}`
          : undefined
    );
  } finally {
    unsubscribe();
  }
  if (selection) return { status: "selected", ...selection };
  return {
    status: "failed",
    reason:
      outcome.status === "completed"
        ? `${DRAW_EVALUATOR_NAME}结束时没有调用 ${SELECT_TOOL_NAME}。`
        : outcome.summary
  };
}
