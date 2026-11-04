import {
  activeSubagentDraw,
  type AgentProviderRuntimeConfig,
  type AgentTeamRunMode,
  type AgentTeamWorkspaceType,
  type ShortAgentSubagentDefinition,
  type WorkspaceAgentId
} from "@deepwrite/contracts";
import { assertModelRunSettings } from "./model-run-settings";

export interface AgentTeamRunTarget {
  workspaceType: AgentTeamWorkspaceType;
  parentAgentId: WorkspaceAgentId | "long";
  /** The book being written; a book's team binding outranks the enabled team. */
  bookId?: string;
}

export interface AgentTeamRunModeDependencies {
  resolveDefinitions(
    workspaceType: AgentTeamWorkspaceType,
    parentAgentId: WorkspaceAgentId | "long",
    bookId?: string
  ): Promise<ShortAgentSubagentDefinition[]>;
  resolveModel(
    modelId: string
  ): Promise<AgentProviderRuntimeConfig | undefined>;
  resolveParallelSubagents?(
    workspaceType: AgentTeamWorkspaceType,
    bookId?: string
  ): Promise<boolean>;
}

export interface ResolvedAgentTeamRuntime {
  subagentDefinitions?: ShortAgentSubagentDefinition[];
  subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig>;
  parallelSubagents?: true;
}

export async function resolveAgentTeamRuntime(
  mode: AgentTeamRunMode | undefined,
  target: AgentTeamRunTarget | undefined,
  dependencies: AgentTeamRunModeDependencies
): Promise<ResolvedAgentTeamRuntime> {
  if (mode !== "team") {
    return { subagentRuntimeConfigs: {} };
  }
  if (!target) {
    throw new Error("团队模式仅适用于短篇、剧本或长篇创作智能体。");
  }

  const subagentDefinitions = await dependencies.resolveDefinitions(
    target.workspaceType,
    target.parentAgentId,
    target.bookId
  );
  if (subagentDefinitions.length === 0) {
    throw new Error(
      "当前智能体没有已启用且含可用成员的团队，请先在“智能体团队”中完成配置。"
    );
  }

  const subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig> = {};
  const resolveCustomModel = async (
    owner: string,
    settings: {
      modelId: string;
      thinkingLevel: ShortAgentSubagentDefinition["thinkingLevel"];
      temperature: ShortAgentSubagentDefinition["temperature"];
    }
  ): Promise<void> => {
    const resolved =
      subagentRuntimeConfigs[settings.modelId] ??
      (await dependencies.resolveModel(settings.modelId));
    if (!resolved) {
      throw new Error(
        `团队智能体有未知模型配置：${owner}选择的模型已不存在，请在“智能体团队”中重新选择模型。`
      );
    }
    assertModelRunSettings(resolved, {
      thinkingLevel: settings.thinkingLevel,
      temperature: settings.temperature
    });
    subagentRuntimeConfigs[settings.modelId] = resolved;
  };
  for (const definition of subagentDefinitions) {
    if (definition.modelMode === "custom" && definition.modelId) {
      await resolveCustomModel(`子智能体「${definition.name}」`, {
        modelId: definition.modelId,
        thinkingLevel: definition.thinkingLevel,
        temperature: definition.temperature
      });
    }
    const draw = activeSubagentDraw(definition);
    const evaluator = draw?.evaluator;
    if (
      draw?.selection === "auto" &&
      evaluator?.modelMode === "custom" &&
      evaluator.modelId
    ) {
      await resolveCustomModel(`子智能体「${definition.name}」的评估助手`, {
        modelId: evaluator.modelId,
        thinkingLevel: evaluator.thinkingLevel,
        temperature: evaluator.temperature
      });
    }
  }

  const parallelSubagents =
    (await dependencies.resolveParallelSubagents?.(
      target.workspaceType,
      target.bookId
    )) === true;
  return {
    subagentDefinitions,
    subagentRuntimeConfigs,
    ...(parallelSubagents ? { parallelSubagents: true as const } : {})
  };
}
