import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import type { PortableToolSchemaProfile } from "./portable-tool-schema";
import { createLibraryManagementRuntime } from "./library-management-runtime";
import { createMaterialQueryRunner } from "./material-query-runtime";
import { buildChatAssistantTools } from "./chat-assistant-tools";
import { buildLearningImitationTools } from "./learning-imitation-tools";
import { buildLibraryAgentTools } from "./library-agent-tools";
import { buildLongBookAnalysisTools } from "./long-book-analysis/tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceToolSharedState
} from "./long-agent-tools";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createScriptWorkspaceToolSharedState,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { buildSubagentAuthoringTools } from "./subagent-authoring-tools";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { buildProviderRuntime, toPiThinkingLevel } from "./provider-runtime";
import {
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts";
export interface BuildRunToolsOptions extends Pick<
  BuildSpawnSubagentToolInput,
  | "model"
  | "streamFn"
  | "parentRuntime"
  | "parentSignal"
  | "toolExecutionHooks"
  | "retryPolicy"
  | "timeoutMs"
> {
  parentRuntime: NonNullable<BuildSpawnSubagentToolInput["parentRuntime"]>;
  toolExecutionHooks: NonNullable<
    BuildSpawnSubagentToolInput["toolExecutionHooks"]
  >;
  thinkingLevel: PiThinkingLevel;
  requestUserInput: AgentUserInputRequester;
  getParentMessages: () => readonly AgentMessage[];
  portableToolSchemaProfile: PortableToolSchemaProfile;
  subagentTimeoutMs?: number;
}
export function buildRunTools(
  input: AgentRunInput,
  options: BuildRunToolsOptions
): AgentTool[] {
  if (input.workspaceContext?.styleComparison) return [];
  const {
    model,
    thinkingLevel: effectiveThinkingLevel,
    streamFn: spawnStreamFn,
    parentRuntime: runtime,
    requestUserInput,
    portableToolSchemaProfile
  } = options;
  const {
    shortWorkspace,
    scriptWorkspace,
    longWorkspace,
    libraryWorkspace,
    learningImitation,
    longBookAnalysis,
    subagentAuthoring
  } = input.workspaceContext ?? {};
  const writingToolSharedState =
    scriptWorkspace && input.scriptAgentProfile
      ? createScriptWorkspaceToolSharedState(scriptWorkspace)
      : shortWorkspace && input.agentProfile
        ? createShortWorkspaceToolSharedState(shortWorkspace)
        : undefined;
  const longToolSharedState =
    longWorkspace && input.longAgentProfile
      ? createLongWorkspaceToolSharedState()
      : undefined;
  const buildWritingTools = (): AgentTool[] => {
    if (scriptWorkspace && input.scriptAgentProfile) {
      return buildScriptWorkspaceTools({
        workspace: scriptWorkspace,
        profile: input.scriptAgentProfile,
        writeApprovalMode: input.writeApprovalMode ?? "request-approval",
        autoApproveCrossStageOperations:
          input.autoApproveCrossStageOperations === true,
        attachedSkills: input.workspaceContext?.attachedSkills,
        attachedMaterials: input.workspaceContext?.attachedMaterials,
        queryMaterials: createMaterialQueryRunner(input),
        requestUserInput,
        ...(writingToolSharedState
          ? { sharedState: writingToolSharedState }
          : {})
      });
    }
    return shortWorkspace && input.agentProfile
      ? buildShortWorkspaceTools({
          workspace: shortWorkspace,
          profile: input.agentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          requestUserInput,
          ...(writingToolSharedState
            ? { sharedState: writingToolSharedState }
            : {})
        })
      : [];
  };
  const buildLongTools = (includeAskUserQuestion = true): AgentTool[] =>
    longWorkspace && input.longAgentProfile
      ? buildLongWorkspaceTools({
          workspace: longWorkspace,
          profile: input.longAgentProfile,
          sessionId: input.sessionId,
          runId: input.runId,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          ...(input.longCommandExecutor
            ? { executor: input.longCommandExecutor }
            : {}),
          requestUserInput,
          includeAskUserQuestion,
          ...(longToolSharedState ? { sharedState: longToolSharedState } : {})
        })
      : [];
  const management = createLibraryManagementRuntime(input);
  let tools: AgentTool[] =
    input.mode === "chat-assistant"
      ? input.chatAssistantRuntimeContext
        ? buildChatAssistantTools({
            runId: input.runId,
            sessionId: input.sessionId,
            context: input.chatAssistantRuntimeContext,
            ...(input.longCommandExecutor
              ? { longCommandExecutor: input.longCommandExecutor }
              : {})
          })
        : []
      : subagentAuthoring
        ? buildSubagentAuthoringTools(subagentAuthoring)
        : learningImitation && input.learningImitationProfile
          ? buildLearningImitationTools(
              learningImitation,
              input.writeApprovalMode ?? "request-approval"
            )
          : longBookAnalysis && input.longBookAnalysisProfile
            ? buildLongBookAnalysisTools(longBookAnalysis)
            : libraryWorkspace && input.libraryAgentProfile
              ? buildLibraryAgentTools({
                  workspace: libraryWorkspace,
                  profile: input.libraryAgentProfile,
                  writeApprovalMode:
                    input.writeApprovalMode ?? "request-approval",
                  attachedSkills: input.workspaceContext?.attachedSkills
                })
              : longWorkspace && input.longAgentProfile
                ? buildLongTools()
                : (scriptWorkspace && input.scriptAgentProfile) ||
                    (shortWorkspace && input.agentProfile)
                  ? buildWritingTools()
                  : [];
  if (
    ((scriptWorkspace && input.scriptAgentProfile) ||
      (shortWorkspace && input.agentProfile) ||
      (longWorkspace && input.longAgentProfile)) &&
    !subagentAuthoring
  ) {
    const spawnTool = buildSpawnSubagentTool({
      parentSessionId: input.sessionId,
      ...((options.parentSignal ?? input.signal)
        ? { parentSignal: options.parentSignal ?? input.signal }
        : {}),
      parentRuntime: runtime,
      model,
      thinkingLevel: effectiveThinkingLevel,
      streamFn: spawnStreamFn,
      definitions: [
        ...(input.subagentDefinitions ?? []),
        ...management.definitions
      ],
      prepareChild: management.prepareChild,
      getParentMessages: options.getParentMessages,
      ...(input.subagentRuntimeConfigs
        ? { subagentRuntimeConfigs: input.subagentRuntimeConfigs }
        : {}),
      buildCustomModelRuntime: (config, options) => {
        const childThinking =
          options?.thinkingLevel ?? config.defaultThinkingLevel ?? "medium";
        const childTemperature =
          childThinking === "off"
            ? (options?.temperature ?? config.temperatureOptions[1])
            : undefined;
        const childRuntime = buildProviderRuntime(
          config,
          childTemperature,
          childThinking,
          { portableToolSchemaProfile }
        );
        return {
          model: childRuntime.model,
          streamFn: childRuntime.streamFn,
          thinkingLevel: toPiThinkingLevel(childThinking)
        };
      },
      buildChildTools:
        longWorkspace && input.longAgentProfile
          ? () => buildLongTools(false)
          : buildWritingTools,
      ...(scriptWorkspace
        ? {
            systemPromptRequirements: scriptRuntimeSystemRequirements(input)
          }
        : shortWorkspace
          ? {
              systemPromptRequirements: shortRuntimeSystemRequirements(input)
            }
          : longWorkspace
            ? {
                systemPromptRequirements:
                  input.writeApprovalMode === "auto-approve"
                    ? "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；提案会进入实时自动保存队列，在客户端确认成功前不能宣称已落盘或已提交连续性账本。"
                    : "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；任何写入仍须形成可审阅提案，不能宣称已落盘或已提交连续性账本。"
              }
            : {}),
      toolExecutionHooks: options.toolExecutionHooks,
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
      ...(options.subagentTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.subagentTimeoutMs }),
      depth: 0
    });
    if (spawnTool) tools = [...tools, spawnTool];
  }

  return tools;
}
