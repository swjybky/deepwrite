import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import type { PortableToolSchemaProfile } from "./portable-tool-schema";
import { createLibraryManagementRuntime } from "./library-management-runtime";
import { createTeamManagementRuntime } from "./team-management-runtime";
import { createMaterialQueryRunner } from "./material-query-runtime";
import { buildLibraryAgentTools } from "./library-agent-tools";
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
import { buildSubagentMaterialContext } from "./prompts-material";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";
import { writeApprovalBoundary } from "./write-approval";
import { writingSubagentContext } from "./writing-subagent-context";
import { buildProviderRuntime, toPiThinkingLevel } from "./provider-runtime";
import { mainWebSearchSession, withWebSearchTool } from "./web-search/mount";
import { webToolNamesFor } from "./web-search/prompt";
import {
  createWebSearchSession,
  type WebSearchSession
} from "./web-search/session";
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
  onContextCompacted?: (listener: () => void) => void;
}
export function buildRunTools(
  input: AgentRunInput,
  options: BuildRunToolsOptions
): AgentTool[] {
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
    subagentAuthoring
  } = input.workspaceContext ?? {};
  // One search budget for the main agent and every subagent of this run. The
  // session exists whenever Main supplied settings; the main agent only mounts
  // it while its switch is on, and each member follows its own web search mode.
  const runSignal = options.parentSignal ?? input.signal;
  const webSearch = input.webSearch
    ? createWebSearchSession(input.webSearch, {
        ...(runSignal ? { signal: runSignal } : {}),
        localFaux: runtime.mode === "local-faux"
      })
    : undefined;
  const mainWebSearch = mainWebSearchSession(webSearch, input);
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
  const buildWritingToolSet = (
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] => {
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
        ...(onContextCompacted ? { onContextCompacted } : {}),
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
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(writingToolSharedState
            ? { sharedState: writingToolSharedState }
            : {})
        })
      : [];
  };
  // `search` is explicit: a default would turn "no search" into the full session.
  const buildWritingTools = (
    onContextCompacted: Parameters<typeof buildWritingToolSet>[0],
    search: WebSearchSession | undefined
  ): AgentTool[] =>
    withWebSearchTool(buildWritingToolSet(onContextCompacted), search);
  const buildLongToolSet = (
    includeAskUserQuestion = true,
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] =>
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
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(longToolSharedState ? { sharedState: longToolSharedState } : {})
        })
      : [];
  const buildLongTools = (
    includeAskUserQuestion: boolean,
    onContextCompacted: Parameters<typeof buildLongToolSet>[1],
    search: WebSearchSession | undefined
  ): AgentTool[] =>
    withWebSearchTool(
      buildLongToolSet(includeAskUserQuestion, onContextCompacted),
      search
    );
  const management = createLibraryManagementRuntime(
    input,
    mainWebSearch ? { webSearch: mainWebSearch } : {}
  );
  const teamManagement = createTeamManagementRuntime(input, requestUserInput);
  let tools: AgentTool[] = subagentAuthoring
    ? withWebSearchTool(
        buildSubagentAuthoringTools(subagentAuthoring),
        mainWebSearch
      )
    : libraryWorkspace && input.libraryAgentProfile
      ? withWebSearchTool(
          buildLibraryAgentTools({
            workspace: libraryWorkspace,
            profile: input.libraryAgentProfile,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            attachedSkills: input.workspaceContext?.attachedSkills
          }),
          mainWebSearch
        )
      : longWorkspace && input.longAgentProfile
        ? buildLongTools(true, options.onContextCompacted, mainWebSearch)
        : (scriptWorkspace && input.scriptAgentProfile) ||
            (shortWorkspace && input.agentProfile)
          ? buildWritingTools(options.onContextCompacted, mainWebSearch)
          : [];
  if (
    ((scriptWorkspace && input.scriptAgentProfile) ||
      (shortWorkspace && input.agentProfile) ||
      (longWorkspace && input.longAgentProfile)) &&
    !subagentAuthoring
  ) {
    const parentPolicy = workspaceContextPolicy(input);
    const childContextPolicy = parentPolicy && {
      settings: parentPolicy.settings,
      task: parentPolicy.task,
      toolCompactors: parentPolicy.toolCompactors,
      ...(parentPolicy.rehydrate ? { rehydrate: parentPolicy.rehydrate } : {})
    };
    const spawnTool = buildSpawnSubagentTool({
      parentSessionId: input.sessionId,
      ...((options.parentSignal ?? input.signal)
        ? { parentSignal: options.parentSignal ?? input.signal }
        : {}),
      parentRuntime: runtime,
      model,
      thinkingLevel: effectiveThinkingLevel,
      streamFn: spawnStreamFn,
      requestUserInput,
      definitions: [
        ...(input.subagentDefinitions ?? []),
        ...management.definitions,
        ...teamManagement.definitions
      ],
      prepareChild: (definition, libraryId, signal) =>
        definition.toolSource === "team-management"
          ? teamManagement.prepareChild(definition)
          : management.prepareChild(definition, libraryId, signal),
      getParentMessages: options.getParentMessages,
      ...(childContextPolicy ? { contextPolicy: childContextPolicy } : {}),
      materialContext: buildSubagentMaterialContext(input),
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
          ? (listener) => buildLongTools(false, listener, webSearch)
          : (listener) => buildWritingTools(listener, webSearch),
      mainWebSearch: input.webSearchEnabled === true,
      ...(scriptWorkspace || shortWorkspace
        ? writingSubagentContext(input, writingToolSharedState)
        : longWorkspace
          ? {
              systemPromptRequirements: [
                "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId。交回结果时列出已提交的修改。",
                writeApprovalBoundary(input.writeApprovalMode)
              ].join("\n"),
              pureReadSystemPromptRequirements: `这是长篇主智能体委派的单层只读子任务。只能使用 read、list 读取当前 bookId 的作品，以及 query_linked_material_entries 读取素材${
                input.webSearch
                  ? `；工具清单列有 web_search 时，也可用 ${webToolNamesFor(input.webSearch.providerId)} 查证公开资料`
                  : ""
              }；没有任何写入工具，不能修改作品，也不得声称已修改或已提交连续性账本。`
            }
          : {}),
      toolExecutionHooks: options.toolExecutionHooks,
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
      ...(options.subagentTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.subagentTimeoutMs }),
      depth: 0,
      ...(input.parallelSubagents === true && input.subagentDefinitions?.length
        ? { parallel: true }
        : {})
    });
    if (spawnTool) tools = [...tools, spawnTool];
  }

  return tools;
}
