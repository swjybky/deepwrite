import { traceSubagentStream } from "./subagent-call-trace";
import { randomBytes } from "node:crypto";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import {
  Agent,
  type AgentToolResult,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import type { AgentRuntimeRef, SubagentDrawRef } from "@deepwrite/contracts";
import { runSubagentLifecycle } from "./subagent-lifecycle";
import { waitForSubagentPreparation } from "./subagent-preparation";
import { snapshotSubagentHistory } from "./subagent-history";
import {
  applySubagentAgentMode,
  applySubagentWebSearch,
  subagentAgentMode,
  subagentContextPolicyForMode,
  subagentModeNote,
  subagentModeSystemRequirements
} from "./subagent-mode";
import {
  buildSubagentSystemPrompt,
  textResult,
  SUBAGENT_SUMMARY_MAX_LENGTH
} from "./subagent-helpers";
import {
  resolveSubagentModel,
  subagentModelRuntime,
  withoutProviderRetries
} from "./subagent-model";
import type { SubagentHandoff } from "./subagent-scheduler";
import type {
  BuildSpawnSubagentToolInput,
  SubagentBatchTaskRef,
  SubagentProgressBase,
  SubagentTaskOutcome,
  SubagentTaskRequest,
  SubagentToolDetails,
  SubagentToolProgress
} from "./subagent-types";
import {
  applySubagentWriteLock,
  subagentParallelNote,
  type SubagentWriteLock
} from "./subagent-write-lock";

const HANDOFF_SUMMARY_MAX_LENGTH = 6_000;

export interface SubagentTaskContext {
  parentToolCallId: string;
  request: SubagentTaskRequest;
  /** Present when the call submitted more than one task. */
  batchTask?: SubagentBatchTaskRef;
  /** Present on the candidates and the evaluator of a draw-mode task. */
  draw?: SubagentDrawRef;
  /** Preassigned so a draw can name the candidate that was selected. */
  subagentRunId?: string;
  signal?: AbortSignal;
  writeLock: SubagentWriteLock;
  onUpdate?: (partialResult: AgentToolResult<SubagentToolDetails>) => void;
}

export function childRuntime(
  input: BuildSpawnSubagentToolInput,
  request: SubagentTaskRequest
): AgentRuntimeRef {
  return subagentModelRuntime(input, request.definition);
}

export function createSubagentRunId(
  input: BuildSpawnSubagentToolInput
): string {
  return input.createRunId?.() ?? `subrun_${randomBytes(4).toString("hex")}`;
}

function progressBase(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext
): SubagentProgressBase {
  return {
    parentToolCallId: context.parentToolCallId,
    subagentRunId: context.subagentRunId ?? createSubagentRunId(input),
    subagentId: context.request.definition.id,
    name: context.request.definition.name,
    runtime: childRuntime(input, context.request),
    ...(context.batchTask ? { batchTask: context.batchTask } : {}),
    ...(context.draw ? { draw: context.draw } : {})
  };
}

export function emitter(context: Pick<SubagentTaskContext, "onUpdate">) {
  return (progress: SubagentToolProgress, text: string): void => {
    context.onUpdate?.(
      textResult(text, { kind: "subagent-progress", progress })
    );
  };
}

/** Terminal event for a task the scheduler never started. */
export function reportUnstartedSubagentTask(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext,
  outcome: SubagentTaskOutcome
): void {
  emitter(context)(
    {
      ...progressBase(input, context),
      type: "completed",
      status: outcome.status,
      summary: outcome.summary,
      errorMessage: outcome.summary.slice(0, 4_000)
    },
    outcome.summary
  );
}

function handoffSection(
  handoffs: readonly SubagentHandoff[],
  english: boolean
): string {
  return [
    english
      ? "[Predecessor task handoffs] Dependencies finished; use their summaries as needed:"
      : "【前置任务交接】本任务依赖的前置子任务已经完成，以下是它们的交接摘要，按需参考：",
    ...handoffs.map(
      (handoff) =>
        `### ${handoff.key}（${handoff.name}）\n${handoff.summary.slice(0, HANDOFF_SUMMARY_MAX_LENGTH)}`
    )
  ].join("\n\n");
}

/** Joins optional background sections and the task into one user message. */
export function composeSubagentTaskPrompt(options: {
  task: string;
  materialContext?: string;
  handoffs: readonly SubagentHandoff[];
  english: boolean;
}): string {
  const sections: string[] = [];
  const material = options.materialContext?.trim();
  if (material) {
    sections.push(
      options.english
        ? `[Available materials for this turn]\n${material}`
        : `【本轮可按需读取的素材上下文】\n${material}`
    );
  }
  if (options.handoffs.length > 0) {
    sections.push(handoffSection(options.handoffs, options.english));
  }
  if (sections.length === 0) return options.task;
  sections.push(
    options.english
      ? `[Assigned task — execute immediately]\n${options.task}`
      : `【本轮委派任务（请立即执行）】\n${options.task}`
  );
  return sections.join("\n\n");
}

/** Builds a fresh, uncached child Agent for one task and runs it to the end. */
export async function runSubagentTask(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext,
  handoffs: readonly SubagentHandoff[]
): Promise<SubagentTaskOutcome> {
  const { request, signal } = context;
  const definition = request.definition;
  const mode = subagentAgentMode(definition);
  const english = input.promptLocale === "en-US";
  const childMessages =
    definition.contextMode === "parent-snapshot"
      ? snapshotSubagentHistory(input.getParentMessages?.() ?? [])
      : [];
  const base = progressBase(input, context);
  const emitProgress = emitter(context);
  emitProgress(
    { ...base, type: "started", task: request.task },
    `子智能体「${definition.name}」已开始执行。`
  );

  const compactionListeners = new Set<
    (removedToolCallIds?: readonly string[]) => void
  >();
  let childContextPolicy = subagentContextPolicyForMode(
    input.contextPolicy,
    mode
  );
  let child: Agent;
  let childTask = request.task;
  let prepared:
    | Awaited<
        ReturnType<NonNullable<BuildSpawnSubagentToolInput["prepareChild"]>>
      >
    | undefined;
  try {
    const resolvedModel = resolveSubagentModel(
      input,
      definition,
      `子智能体「${definition.name}」`
    );
    const childModel = resolvedModel.model;
    let childStreamFn = resolvedModel.streamFn;
    const childThinkingLevel = resolvedModel.thinkingLevel;
    prepared =
      input.workspaceAccess === "none"
        ? await waitForSubagentPreparation(
            input.prepareChild?.(
              definition,
              request.libraryId,
              signal,
              request
            ),
            signal
          )
        : undefined;
    signal?.throwIfAborted();
    if (input.workspaceAccess === "none" && !prepared)
      throw new Error("扩展子任务运行上下文不可用。");
    if (prepared?.contextPolicy) childContextPolicy = prepared.contextPolicy;
    if (prepared?.task) childTask = prepared.task;
    // Only the child sees its draw's requirement; progress keeps the shared task.
    if (context.draw?.role === "candidate" && context.draw.variant) {
      childTask = `${childTask}\n\n【本份侧重】在满足上面全部要求的前提下，这一份按以下方向处理：${context.draw.variant}`;
    }
    if (prepared?.fauxResponses && input.parentRuntime?.mode === "local-faux") {
      const models = createModels();
      const faux = fauxProvider({
        api: input.model.api,
        provider: input.model.provider,
        models: [
          { id: input.model.id, name: input.model.name, reasoning: true }
        ],
        tokensPerSecond: 0
      });
      models.setProvider(faux.provider);
      faux.setResponses(prepared.fauxResponses);
      childStreamFn = models.streamSimple.bind(models) as StreamFn;
    }
    // A bare child never builds the work's tools at all.
    const builtTools =
      mode === "pure-bare"
        ? []
        : (
            prepared?.tools ??
            input.buildChildTools((listener) =>
              compactionListeners.add(listener)
            )
          ).filter(
            (tool) =>
              tool.name !== "spawn_subagent" &&
              tool.name !== "load_skill" &&
              tool.name !== "ask_user_question"
          );
    // Extras children own their tools; only the work's
    // write tools of a parallel standard child share the lock.
    const sharesWorkspace =
      input.parallel === true &&
      mode === "standard" &&
      input.workspaceAccess !== "none";
    const searchTools = applySubagentWebSearch(
      builtTools,
      definition.webSearchMode,
      input.mainWebSearch === true
    );
    const childTools = sharesWorkspace
      ? applySubagentWriteLock(
          applySubagentAgentMode(searchTools, mode),
          context.writeLock,
          `「${definition.name}」（${request.key}）`
        )
      : applySubagentAgentMode(searchTools, mode);
    const childDefinition = prepared
      ? { ...definition, systemPrompt: prepared.systemPrompt }
      : definition;
    child = new Agent({
      initialState: {
        systemPrompt: buildSubagentSystemPrompt(
          childDefinition,
          childTools,
          prepared
            ? undefined
            : await waitForSubagentPreparation(
                subagentModeSystemRequirements(
                  input,
                  mode,
                  childTools.map((tool) => tool.name)
                ),
                signal
              ),
          // A pure child states its mode; a parallel standard child states
          // that others may be changing the work at the same time.
          subagentModeNote(mode, input.promptLocale === "en-US") ??
            (sharesWorkspace
              ? input.promptLocale === "en-US"
                ? "Other agents can edit this work concurrently. Check current targets and avoid overwriting their changes."
                : subagentParallelNote()
              : undefined),
          input.promptLocale
        ),
        model: childModel,
        thinkingLevel: childThinkingLevel,
        messages: childMessages,
        // buildChildTools() creates fresh read evidence while closing over the
        // same parent-run mutation/revision overlay.
        tools: childTools
      },
      streamFn: traceSubagentStream(
        withoutProviderRetries(childStreamFn),
        (activity) =>
          emitProgress({ ...base, type: "activity", activity }, "模型调用记录"),
        ...(input.evaluationMode ? [{ captureSnapshot: true }] : [])
      ),
      sessionId: `${input.parentSessionId}:${base.subagentRunId}`,
      toolExecution: "sequential",
      ...input.toolExecutionHooks
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "子智能体初始化失败。";
    const status = signal?.aborted ? "aborted" : "error";
    const summary =
      `${signal?.aborted ? "子智能体执行已中止" : "子智能体执行失败"}：${errorMessage}`.slice(
        0,
        SUBAGENT_SUMMARY_MAX_LENGTH
      );
    emitProgress(
      {
        ...base,
        type: "completed",
        status,
        summary,
        errorMessage: errorMessage.slice(0, 4_000)
      },
      summary
    );
    return { status, summary };
  }

  const materialContext =
    mode !== "pure-bare" ? input.materialContext?.trim() : undefined;
  const promptTask = composeSubagentTaskPrompt({
    task: childTask,
    ...(materialContext ? { materialContext } : {}),
    handoffs,
    english
  });

  const outcome = await runSubagentLifecycle(
    child,
    {
      ...input,
      ...(childContextPolicy ? { contextPolicy: childContextPolicy } : {})
    },
    base,
    promptTask,
    base.runtime!,
    emitProgress,
    signal,
    (ids) => {
      for (const listener of compactionListeners) listener(ids);
    }
  );
  prepared?.onComplete?.(outcome);
  return outcome;
}
