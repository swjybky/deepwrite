import { randomBytes } from "node:crypto";
import {
  Agent,
  type AgentTool,
  type AgentToolResult,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import { piStrictToolSampling } from "./pi-tool-schema";
import { runSubagentLifecycle } from "./subagent-lifecycle";
import { waitForSubagentPreparation } from "./subagent-preparation";
import { snapshotSubagentHistory } from "./subagent-history";
import {
  buildSubagentSystemPrompt,
  textResult,
  runtimeFromConfig,
  runtimeFromModel,
  SUBAGENT_SUMMARY_MAX_LENGTH
} from "./subagent-helpers";
import type {
  BuildSpawnSubagentToolInput,
  SubagentToolDetails,
  SubagentProgressBase,
  SubagentToolProgress
} from "./subagent-types";
export * from "./subagent-types";
export { buildSubagentSystemPrompt } from "./subagent-helpers";
export { DEFAULT_SUBAGENT_TIMEOUT_MS } from "./subagent-timeout";
/**
 * Builds the sole delegation capability exposed to a parent creative-workspace
 * agent. Every invocation creates a fresh, uncached Agent instance.
 */
export function buildSpawnSubagentTool(
  input: BuildSpawnSubagentToolInput
): AgentTool | undefined {
  const definitions = input.definitions.filter(
    (definition) => definition.enabled
  );
  if (definitions.length === 0 || (input.depth ?? 0) > 0) return undefined;

  const parameters = Type.Object({
    subagent_id: StringEnum(definitions.map((definition) => definition.id)),
    task: Type.String({ minLength: 1, maxLength: 20_000 }),
    library_id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        description: "管理子智能体的目标绑定库 id；普通团队成员不填写。"
      })
    )
  });

  const tool: AgentTool<typeof parameters, SubagentToolDetails> = {
    name: "spawn_subagent",
    label: "调用子智能体",
    description: [
      "调用一个预先配置的子智能体完成明确、边界清晰的子任务。调用会阻塞到子智能体完成，并只返回最终交接摘要。",
      "可用子智能体：",
      ...definitions.map(
        (definition) =>
          `- ${definition.name} (${definition.id})：${definition.description}`
      )
    ].join("\n"),
    parameters,
    ...piStrictToolSampling(parameters),
    executionMode: "sequential",
    execute: async (
      parentToolCallId: string,
      params: Static<typeof parameters>,
      signal?: AbortSignal,
      onUpdate?: (partialResult: AgentToolResult<SubagentToolDetails>) => void
    ): Promise<AgentToolResult<SubagentToolDetails>> => {
      signal = input.parentSignal
        ? AbortSignal.any([input.parentSignal, ...(signal ? [signal] : [])])
        : signal;
      signal?.throwIfAborted();
      if ((input.depth ?? 0) !== 0) {
        throw new Error("子智能体不允许递归调用 spawn_subagent。");
      }
      const subagentId = String(params.subagent_id ?? "");
      const definition = definitions.find(
        (candidate) => candidate.id === subagentId
      );
      if (!definition) {
        throw new Error(`未知或已停用的子智能体：${subagentId}`);
      }
      if (definition.toolSource !== "library-management" && params.library_id)
        throw new Error("普通团队成员不能指定资料库管理目标。");
      const task = String(params.task ?? "").trim();
      if (!task) throw new Error("子智能体任务不能为空。");

      const childMessages =
        definition.contextMode === "parent-snapshot"
          ? snapshotSubagentHistory(input.getParentMessages?.() ?? [])
          : [];
      const subagentRunId =
        input.createRunId?.() ?? `subrun_${randomBytes(4).toString("hex")}`;
      const configuredChildModelId =
        definition.modelMode === "custom"
          ? definition.modelId?.trim()
          : undefined;
      const configuredChildRuntime = configuredChildModelId
        ? input.subagentRuntimeConfigs?.[configuredChildModelId]
        : undefined;
      const childRuntime = configuredChildRuntime
        ? runtimeFromConfig(configuredChildRuntime)
        : (input.parentRuntime ?? runtimeFromModel(input.model));
      const progressBase: SubagentProgressBase = {
        parentToolCallId,
        subagentRunId,
        subagentId: definition.id,
        name: definition.name,
        runtime: childRuntime
      };
      const emitProgress = (
        progress: SubagentToolProgress,
        text: string
      ): void => {
        onUpdate?.(textResult(text, { kind: "subagent-progress", progress }));
      };

      emitProgress(
        { ...progressBase, type: "started", task },
        `子智能体「${definition.name}」已开始执行。`
      );

      let child: Agent;
      try {
        let childModel = input.model;
        let childStreamFn = input.streamFn;
        let childThinkingLevel = input.thinkingLevel;
        if (definition.modelMode === "custom") {
          const modelId = definition.modelId?.trim();
          if (!modelId) {
            throw new Error(`子智能体「${definition.name}」未配置模型。`);
          }
          const runtimeConfig = input.subagentRuntimeConfigs?.[modelId];
          if (!runtimeConfig) {
            throw new Error(
              `子智能体「${definition.name}」配置的模型不可用，请重新保存智能体团队或刷新模型配置。`
            );
          }
          if (!input.buildCustomModelRuntime) {
            throw new Error("当前运行时不支持子智能体单独配置模型。");
          }
          const customRuntime = input.buildCustomModelRuntime(runtimeConfig, {
            ...(definition.thinkingLevel !== undefined
              ? { thinkingLevel: definition.thinkingLevel }
              : {}),
            ...(definition.temperature !== undefined
              ? { temperature: definition.temperature }
              : {})
          });
          childModel = customRuntime.model;
          childStreamFn = customRuntime.streamFn;
          childThinkingLevel = customRuntime.thinkingLevel;
        }
        const prepared =
          definition.toolSource === "library-management"
            ? await waitForSubagentPreparation(
                input.prepareChild?.(definition, params.library_id, signal),
                signal
              )
            : undefined;
        signal?.throwIfAborted();
        if (definition.toolSource === "library-management" && !prepared)
          throw new Error("资料库管理运行上下文不可用。");
        const childTools = (prepared?.tools ?? input.buildChildTools()).filter(
          (tool) =>
            tool.name !== "spawn_subagent" &&
            (definition.toolSource === "library-management" ||
              (tool.name !== "load_skill" && tool.name !== "ask_user_question"))
        );
        if (definition.toolSource === "library-management") {
          for (const [index, tool] of childTools.entries()) {
            childTools[index] = {
              ...tool,
              execute: (toolCallId, args, signal, onUpdate) =>
                tool.execute(
                  `${subagentRunId}:${toolCallId}`,
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
        const childStreamWithoutProviderRetries: StreamFn = (
          requestModel,
          context,
          options
        ) =>
          childStreamFn(requestModel, context, {
            ...options,
            // The visible turn coordinator owns the complete retry budget. Keep
            // provider SDK retries disabled for inherited and custom child models
            // as well, otherwise one child attempt can fan out into 2+ requests.
            maxRetries: 0
          });
        child = new Agent({
          initialState: {
            systemPrompt: buildSubagentSystemPrompt(
              childDefinition,
              childTools,
              prepared ? undefined : input.systemPromptRequirements
            ),
            model: childModel,
            thinkingLevel: childThinkingLevel,
            messages: childMessages,
            // buildChildTools() creates fresh read evidence while closing over the
            // same parent-run mutation/revision overlay.
            tools: childTools
          },
          streamFn: childStreamWithoutProviderRetries,
          sessionId: `${input.parentSessionId}:${subagentRunId}`,
          toolExecution: "sequential",
          ...input.toolExecutionHooks
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "子智能体初始化失败。";
        const initializationStatus = signal?.aborted ? "aborted" : "error";
        const summary =
          `${signal?.aborted ? "子智能体执行已中止" : "子智能体执行失败"}：${errorMessage}`.slice(
            0,
            SUBAGENT_SUMMARY_MAX_LENGTH
          );
        emitProgress(
          {
            ...progressBase,
            type: "completed",
            status: initializationStatus,
            summary,
            errorMessage: errorMessage.slice(0, 4_000)
          },
          summary
        );
        return textResult(summary, { kind: "subagent-result" });
      }

      return runSubagentLifecycle(
        child,
        input,
        progressBase,
        task,
        childRuntime,
        emitProgress,
        signal
      );
    }
  };
  return tool;
}
