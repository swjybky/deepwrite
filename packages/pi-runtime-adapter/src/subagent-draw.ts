import {
  SUBAGENT_DRAW_QUESTION_ID,
  SUBAGENT_DRAW_REJECT_OPTION_ID,
  type SubagentDrawSelectedBy,
  type SubagentDrawSettings,
  type SubagentDrawUpdatedPayload
} from "@deepwrite/contracts";
import {
  createSubagentRunId,
  emitter,
  runSubagentTask,
  type SubagentTaskContext
} from "./subagent-child";
import {
  runDrawEvaluator,
  type DrawCandidate
} from "./subagent-draw-evaluator";
import type { ConcurrencyLimiter } from "./concurrency-limiter";
import type { SubagentHandoff } from "./subagent-scheduler";
import type {
  BuildSpawnSubagentToolInput,
  SubagentDrawPlan,
  SubagentTaskOutcome
} from "./subagent-types";

const SELECTED_BY_LABELS: Record<SubagentDrawSelectedBy, string> = {
  user: "用户选择",
  evaluator: "评估助手选择",
  "only-success": "只有一份成功，直接采用"
};

type DrawUpdate = Omit<
  SubagentDrawUpdatedPayload,
  | "sessionId"
  | "runId"
  | "parentToolCallId"
  | "subagentId"
  | "name"
  | "batchTask"
  | "count"
>;

type DrawChoice =
  | { kind: "selected"; candidate: DrawCandidate; note?: string }
  | { kind: "rejected"; note?: string };

function settledOutcome(
  result: PromiseSettledResult<SubagentTaskOutcome>
): SubagentTaskOutcome {
  return result.status === "fulfilled"
    ? result.value
    : {
        status: "error",
        summary: `子智能体执行失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      };
}

function variantNote(candidate: DrawCandidate): string {
  return candidate.variant ? `（侧重：${candidate.variant}）` : "";
}

function selectedSummary(
  count: number,
  successCount: number,
  candidate: DrawCandidate,
  selectedBy: SubagentDrawSelectedBy,
  detail: { reason?: string; note?: string }
): string {
  const head =
    selectedBy === "only-success"
      ? `【抽卡结果】共 ${count} 份，只有第 ${candidate.number} 份${variantNote(candidate)}成功，已直接采用。`
      : `【抽卡结果】共 ${count} 份（成功 ${successCount} 份），${SELECTED_BY_LABELS[selectedBy]}第 ${candidate.number} 份${variantNote(candidate)}。`;
  return [
    [
      head,
      ...(detail.reason ? [`理由：${detail.reason}`] : []),
      ...(detail.note ? [`用户附言：${detail.note}`] : [])
    ].join("\n"),
    candidate.summary
  ].join("\n\n");
}

async function askUserToChoose(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext,
  count: number,
  candidates: readonly DrawCandidate[],
  fallbackReason: string | undefined
): Promise<DrawChoice> {
  if (!input.requestUserInput) {
    throw new Error("当前运行无法请用户选择抽卡结果。");
  }
  const { request } = context;
  const response = await input.requestUserInput(
    {
      toolCallId: context.parentToolCallId,
      source: "subagent_draw",
      questions: [
        {
          id: SUBAGENT_DRAW_QUESTION_ID,
          header: "抽卡",
          question: `「${request.definition.name}」的 ${candidates.length} 份候选已生成，选一份交给主智能体。`
        }
      ],
      draw: {
        parentToolCallId: context.parentToolCallId,
        subagentId: request.definition.id,
        name: request.definition.name,
        ...(context.batchTask ? { taskKey: context.batchTask.key } : {}),
        task: request.task,
        count,
        candidates: candidates.map((candidate) => ({
          id: `c${candidate.number}`,
          index: candidate.index,
          subagentRunId: candidate.subagentRunId,
          text: candidate.summary,
          ...(candidate.variant ? { variant: candidate.variant } : {})
        })),
        ...(fallbackReason
          ? { fallbackReason: fallbackReason.slice(0, 2_000) }
          : {})
      }
    },
    context.signal
  );
  const answer = response.answers.find(
    (item) => item.id === SUBAGENT_DRAW_QUESTION_ID
  );
  const note = answer?.text?.trim() || undefined;
  const picked = answer?.selectedOptionIds?.[0];
  const candidate = candidates.find((item) => `c${item.number}` === picked);
  if (candidate)
    return { kind: "selected", candidate, ...(note ? { note } : {}) };
  if (picked === SUBAGENT_DRAW_REJECT_OPTION_ID) {
    return { kind: "rejected", ...(note ? { note } : {}) };
  }
  throw new Error("抽卡选择的回答无效。");
}

/**
 * Runs one task of a draw-mode member: every draw is a fresh child, all of
 * them start at once (bounded by the call's limiter), and only the selected
 * result returns as the task's outcome. An auto-count plan gives each draw
 * its own requirement.
 */
export async function runSubagentDrawTask(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext,
  handoffs: readonly SubagentHandoff[],
  settings: SubagentDrawSettings,
  plan: SubagentDrawPlan,
  limiter: ConcurrencyLimiter
): Promise<SubagentTaskOutcome> {
  const { request, signal } = context;
  const count = plan.count;
  const emit = emitter(context);
  const update = (fields: DrawUpdate, text: string): void =>
    emit(
      {
        type: "draw_updated",
        parentToolCallId: context.parentToolCallId,
        subagentId: request.definition.id,
        name: request.definition.name,
        ...(context.batchTask ? { batchTask: context.batchTask } : {}),
        count,
        ...fields
      },
      text
    );
  const aborted = (): SubagentTaskOutcome => {
    update({ phase: "failed", reason: "主智能体运行已中止。" }, "抽卡已中止。");
    return { status: "aborted", summary: "抽卡已中止：主智能体运行已中止。" };
  };

  const runIds = Array.from({ length: count }, () =>
    createSubagentRunId(input)
  );
  const outcomes = (
    await Promise.allSettled(
      runIds.map((subagentRunId, index) => {
        const variant = plan.variants?.[index];
        return limiter.run(() =>
          runSubagentTask(
            input,
            {
              ...context,
              subagentRunId,
              draw: {
                role: "candidate",
                index,
                count,
                ...(variant ? { variant } : {})
              }
            },
            handoffs
          )
        );
      })
    )
  ).map(settledOutcome);
  if (signal?.aborted) return aborted();

  const candidates: DrawCandidate[] = outcomes.flatMap((outcome, index) => {
    const variant = plan.variants?.[index];
    return outcome.status === "completed"
      ? [
          {
            number: index + 1,
            index,
            subagentRunId: runIds[index]!,
            summary: outcome.summary,
            ...(variant ? { variant } : {})
          }
        ]
      : [];
  });
  if (candidates.length === 0) {
    const reason = outcomes[0]?.summary ?? "没有候选完成。";
    update(
      { phase: "failed", reason: reason.slice(0, 2_000) },
      "抽卡全部失败。"
    );
    return { status: "error", summary: `抽卡 ${count} 份全部失败：${reason}` };
  }

  const select = (
    candidate: DrawCandidate,
    selectedBy: SubagentDrawSelectedBy,
    detail: { reason?: string; note?: string }
  ): SubagentTaskOutcome => {
    update(
      {
        phase: "selected",
        selectedBy,
        selectedIndex: candidate.index,
        selectedSubagentRunId: candidate.subagentRunId,
        ...(detail.reason ? { reason: detail.reason.slice(0, 2_000) } : {}),
        ...(detail.note ? { note: detail.note.slice(0, 4_000) } : {})
      },
      `已采用第 ${candidate.number} 份候选。`
    );
    return {
      status: "completed",
      summary: selectedSummary(
        count,
        candidates.length,
        candidate,
        selectedBy,
        detail
      )
    };
  };
  if (candidates.length === 1) {
    return select(candidates[0]!, "only-success", {});
  }

  let fallbackReason: string | undefined;
  if (settings.selection === "auto") {
    update({ phase: "evaluating" }, "评估助手正在选择。");
    const evaluation = await limiter.run(() =>
      runDrawEvaluator(input, {
        parentToolCallId: context.parentToolCallId,
        request,
        ...(context.batchTask ? { batchTask: context.batchTask } : {}),
        ...(signal ? { signal } : {}),
        ...(context.onUpdate ? { onUpdate: context.onUpdate } : {}),
        settings,
        count,
        candidates
      })
    );
    if (signal?.aborted) return aborted();
    if (evaluation.status === "selected") {
      return select(evaluation.candidate, "evaluator", {
        reason: evaluation.reason
      });
    }
    fallbackReason = `评估助手没有完成选择，已改为手动选择：${evaluation.reason}`;
  }

  update(
    {
      phase: "selecting",
      ...(fallbackReason ? { reason: fallbackReason.slice(0, 2_000) } : {})
    },
    "等待用户选择抽卡结果。"
  );
  let choice: DrawChoice;
  try {
    choice = await askUserToChoose(
      input,
      context,
      count,
      candidates,
      fallbackReason
    );
  } catch (error: unknown) {
    if (signal?.aborted) return aborted();
    const reason = error instanceof Error ? error.message : String(error);
    update({ phase: "failed", reason: reason.slice(0, 2_000) }, reason);
    return { status: "error", summary: `抽卡选择失败：${reason}` };
  }
  if (choice.kind === "selected") {
    return select(choice.candidate, "user", {
      ...(choice.note ? { note: choice.note } : {})
    });
  }
  update(
    { phase: "rejected", ...(choice.note ? { note: choice.note } : {}) },
    "用户没有采用任何候选。"
  );
  // Listing the directions lets the parent pick new ones for a retry.
  const directions = candidates.some((candidate) => candidate.variant)
    ? `（侧重依次为：${candidates.map((candidate) => `${candidate.number} ${candidate.variant ?? "无"}`).join("；")}）`
    : "";
  return {
    status: "error",
    summary: [
      `用户没有采用这次抽卡的 ${candidates.length} 份候选${directions}，本任务未完成。`,
      ...(choice.note ? [`用户附言：${choice.note}`] : [])
    ].join("\n")
  };
}
