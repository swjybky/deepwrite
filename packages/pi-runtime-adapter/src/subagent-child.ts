import { randomBytes } from "node:crypto";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import {
  Agent,
  type AgentMessage,
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

function handoffMessage(handoffs: readonly SubagentHandoff[]): AgentMessage {
  return {
    role: "user",
    content: [
      "【前置任务交接】本任务依赖的前置子任务已经完成，以下是它们的交接摘要，按需参考：",
      ...handoffs.map(
        (handoff) =>
          `### ${handoff.key}（${handoff.name}）\n${handoff.summary.slice(0, HANDOFF_SUMMARY_MAX_LENGTH)}`
      )
    ].join("\n\n"),
    timestamp: Date.now()
  };
}

/** Builds a fresh, uncached child Agent for one task and runs it to the end. */
export async function runSubagentTask(
  input: BuildSpawnSubagentToolInput,
  context: SubagentTaskContext,
  handoffs: readonly SubagentHandoff[]
): Promise<SubagentTaskOutcome> {
  const { request, signal } = context;
  const definition = request.definition;
  const libraryManager = definition.toolSource === "library-management";
  const mode = subagentAgentMode(definition);
  const childMessages =
    definition.contextMode === "parent-snapshot"
      ? snapshotSubagentHistory(input.getParentMessages?.() ?? [])
      : [];
  if (
    !libraryManager &&
    mode !== "pure-bare" &&
    input.materialContext?.trim()
  ) {
    childMessages.push({
      role: "user",
      content: `【本轮可按需读取的素材上下文】\n${input.materialContext.trim()}`,
      timestamp: Date.now()
    });
  }
  if (handoffs.length > 0) childMessages.push(handoffMessage(handoffs));
  const base = progressBase(input, context);
  const emitProgress = emitter(context);
  emitProgress(
    { ...base, type: "started", task: request.task },
    `子智能体「${definition.name}」已开始执行。`
  );

  const compactionListeners = new Set<() => void>();
  let childContextPolicy = subagentContextPolicyForMode(
    input.contextPolicy,
    mode
  );
  let child: Agent;
  let childTask = request.task;
  try {
    const resolvedModel = resolveSubagentModel(
      input,
      definition,
      `子智能体「${definition.name}」`
    );
    const childModel = resolvedModel.model;
    let childStreamFn = resolvedModel.streamFn;
    const childThinkingLevel = resolvedModel.thinkingLevel;
    const prepared =
      libraryManager || input.workspaceAccess === "none"
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
    if (libraryManager && !prepared)
      throw new Error("资料库管理运行上下文不可用。");
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
              (libraryManager ||
                (tool.name !== "load_skill" &&
                  tool.name !== "ask_user_question"))
          );
    // Library managers and extras children own their tools; only the work's
    // write tools of a parallel standard child share the lock.
    const sharesWorkspace =
      input.parallel === true &&
      !libraryManager &&
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
    if (libraryManager) {
      for (const [index, tool] of childTools.entries()) {
        childTools[index] = {
          ...tool,
          execute: (toolCallId, args, signal, onUpdate) =>
            tool.execute(
              `${base.subagentRunId}:${toolCallId}`,
              args,
              signal,
              onUpdate
            )
        };
      }
    }
    const childDefinition = prepared
      ? { ...definition, systemPrompt: prepared.systemPrompt }
      : definition;
    child = new Agent({
      initialState: {
        systemPrompt: buildSubagentSystemPrompt(
          childDefinition,
          childTools,
          prepared ? undefined : subagentModeSystemRequirements(input, mode),
          // A pure child states its mode; a parallel standard child states
          // that others may be changing the work at the same time.
          subagentModeNote(mode) ??
            (sharesWorkspace ? subagentParallelNote() : undefined)
        ),
        model: childModel,
        thinkingLevel: childThinkingLevel,
        messages: childMessages,
        // buildChildTools() creates fresh read evidence while closing over the
        // same parent-run mutation/revision overlay.
        tools: childTools
      },
      streamFn: withoutProviderRetries(childStreamFn),
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

  return runSubagentLifecycle(
    child,
    {
      ...input,
      ...(childContextPolicy ? { contextPolicy: childContextPolicy } : {})
    },
    base,
    childTask,
    base.runtime!,
    emitProgress,
    signal,
    () => {
      for (const listener of compactionListeners) listener();
    }
  );
}
