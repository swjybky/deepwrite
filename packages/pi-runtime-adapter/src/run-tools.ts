import { createWritingReader } from "./short-agent-tools/core-reader";
import { settleWritingMutations } from "./short-agent-tools/settlement";
import type { AgentWriteApprovalResponse } from "@deepwrite/contracts";
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
import {
  buildAcademicWorkspaceTools,
  createAcademicWorkspaceToolSharedState,
  createAcademicWritingReader,
  settleAcademicMutations
} from "./academic-agent-tools";
import { buildDomainLibraryAgentTools } from "./library-agent-tools/domain-tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceToolSharedState
} from "./long-agent-tools";
import {
  buildMysteryWorkspaceTools,
  createMysteryWorkspaceToolSharedState,
  mysterySubagentContext
} from "./mystery";
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
import { longSubagentContext } from "./long-subagent-requirements";
import { academicSubagentContext } from "./prompts-academic";
import { writingSubagentContext } from "./writing-subagent-context";
import { buildProviderRuntime, toPiThinkingLevel } from "./provider-runtime";
import { mainWebSearchSession, withWebSearchTool } from "./web-search/mount";
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
  | "evaluationMode"
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
  onContextCompacted?: (
    listener: (removedToolCallIds?: readonly string[]) => void
  ) => void;
  onWriteApprovalSettled?: (
    listener: (
      toolCallIds: string[],
      response?: AgentWriteApprovalResponse
    ) => void
  ) => void;
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
    academicWorkspace,
    mysteryWorkspace,
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
  const academicToolSharedState =
    academicWorkspace && input.academicAgentProfile
      ? createAcademicWorkspaceToolSharedState(academicWorkspace)
      : undefined;
  const mysteryToolSharedState =
    mysteryWorkspace && input.mysteryAgentProfile
      ? createMysteryWorkspaceToolSharedState()
      : undefined;
  // Every proposal of a paused-for step is settled once the user answered:
  // saved ones are in Core now, the rest must not stay visible to reads.
  if (longToolSharedState) {
    options.onWriteApprovalSettled?.(() =>
      longToolSharedState.proposalOverlay.clear()
    );
  }
  if (academicToolSharedState) {
    options.onWriteApprovalSettled?.((ids, response) =>
      settleAcademicMutations(academicToolSharedState, ids, response)
    );
  }
  if (mysteryToolSharedState) {
    options.onWriteApprovalSettled?.(() =>
      mysteryToolSharedState.proposalOverlay.clear()
    );
  }
  if (writingToolSharedState) {
    options.onWriteApprovalSettled?.((ids, response) =>
      settleWritingMutations(writingToolSharedState, ids, response)
    );
  }
  const buildWritingToolSet = (
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] => {
    if (scriptWorkspace && input.scriptAgentProfile) {
      return buildScriptWorkspaceTools({
        promptLocale: input.promptLocale,
        writingReader: createWritingReader(input, scriptWorkspace.id, "script"),
        workspace: scriptWorkspace,
        profile: input.scriptAgentProfile,
        writeApprovalMode: input.writeApprovalMode ?? "request-approval",
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
          promptLocale: input.promptLocale,
          writingReader: createWritingReader(input, shortWorkspace.id, "short"),
          workspace: shortWorkspace,
          profile: input.agentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
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
  const buildAcademicToolSet = (
    includeAskUserQuestion = true,
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] =>
    academicWorkspace && input.academicAgentProfile
      ? buildAcademicWorkspaceTools({
          promptLocale: input.promptLocale,
          writingReader: createAcademicWritingReader(
            input,
            academicWorkspace.id
          ),
          workspace: academicWorkspace,
          profile: input.academicAgentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          requestUserInput,
          includeAskUserQuestion,
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(academicToolSharedState
            ? { sharedState: academicToolSharedState }
            : {})
        })
      : [];
  const buildAcademicTools = (
    includeAskUserQuestion: boolean,
    onContextCompacted: Parameters<typeof buildAcademicToolSet>[1],
    search: WebSearchSession | undefined
  ): AgentTool[] =>
    withWebSearchTool(
      buildAcademicToolSet(includeAskUserQuestion, onContextCompacted),
      search
    );
  const buildMysteryToolSet = (
    includeAskUserQuestion = true,
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] =>
    mysteryWorkspace && input.mysteryAgentProfile
      ? buildMysteryWorkspaceTools({
          promptLocale: input.promptLocale,
          workspace: mysteryWorkspace,
          profile: input.mysteryAgentProfile,
          sessionId: input.sessionId,
          runId: input.runId,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          ...(input.mysteryCommandExecutor
            ? { executor: input.mysteryCommandExecutor }
            : {}),
          requestUserInput,
          includeAskUserQuestion,
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(mysteryToolSharedState
            ? { sharedState: mysteryToolSharedState }
            : {})
        })
      : [];
  const buildMysteryTools = (
    includeAskUserQuestion: boolean,
    onContextCompacted: Parameters<typeof buildMysteryToolSet>[1],
    search: WebSearchSession | undefined
  ): AgentTool[] =>
    withWebSearchTool(
      buildMysteryToolSet(includeAskUserQuestion, onContextCompacted),
      search
    );
  const management = createLibraryManagementRuntime(input);
  options.onWriteApprovalSettled?.(() => management.reset?.());
  const teamManagement = createTeamManagementRuntime(input, requestUserInput);
  let tools: AgentTool[] = subagentAuthoring
    ? withWebSearchTool(
        buildSubagentAuthoringTools(subagentAuthoring),
        mainWebSearch
      )
    : libraryWorkspace && input.libraryAgentProfile
      ? withWebSearchTool(
          buildDomainLibraryAgentTools(
            {
              workspace: libraryWorkspace,
              profile: input.libraryAgentProfile,
              writeApprovalMode: input.writeApprovalMode ?? "request-approval",
              attachedSkills: input.workspaceContext?.attachedSkills
            },
            input
          ),
          mainWebSearch
        )
      : longWorkspace && input.longAgentProfile
        ? buildLongTools(true, options.onContextCompacted, mainWebSearch)
        : academicWorkspace && input.academicAgentProfile
          ? buildAcademicTools(true, options.onContextCompacted, mainWebSearch)
          : mysteryWorkspace && input.mysteryAgentProfile
            ? buildMysteryTools(true, options.onContextCompacted, mainWebSearch)
            : (scriptWorkspace && input.scriptAgentProfile) ||
                (shortWorkspace && input.agentProfile)
              ? buildWritingTools(options.onContextCompacted, mainWebSearch)
              : [];
  if (
    ((scriptWorkspace && input.scriptAgentProfile) ||
      (shortWorkspace && input.agentProfile) ||
      (longWorkspace && input.longAgentProfile) ||
      (academicWorkspace && input.academicAgentProfile) ||
      (mysteryWorkspace && input.mysteryAgentProfile)) &&
    !subagentAuthoring
  ) {
    tools = [...tools, ...management.tools, ...teamManagement.tools];
    const parentPolicy = workspaceContextPolicy(input);
    const childContextPolicy = parentPolicy && {
      settings: parentPolicy.settings,
      task: parentPolicy.task,
      toolCompactors: parentPolicy.toolCompactors,
      ...(parentPolicy.rehydrate ? { rehydrate: parentPolicy.rehydrate } : {})
    };
    const spawnTool = buildSpawnSubagentTool({
      promptLocale: input.promptLocale,
      parentSessionId: input.sessionId,
      ...((options.parentSignal ?? input.signal)
        ? { parentSignal: options.parentSignal ?? input.signal }
        : {}),
      parentRuntime: runtime,
      model,
      thinkingLevel: effectiveThinkingLevel,
      streamFn: spawnStreamFn,
      ...(options.evaluationMode !== undefined
        ? { evaluationMode: options.evaluationMode }
        : {}),
      requestUserInput,
      pausesForWriteApproval: input.writeApprovalMode !== "auto-approve",
      definitions: input.subagentDefinitions ?? [],
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
          : academicWorkspace && input.academicAgentProfile
            ? (listener) => buildAcademicTools(false, listener, webSearch)
            : mysteryWorkspace && input.mysteryAgentProfile
              ? (listener) => buildMysteryTools(false, listener, webSearch)
              : (listener) => buildWritingTools(listener, webSearch),
      mainWebSearch: input.webSearchEnabled === true,
      ...(scriptWorkspace || shortWorkspace
        ? writingSubagentContext(input, writingToolSharedState)
        : longWorkspace
          ? longSubagentContext(input, longToolSharedState)
          : academicWorkspace
            ? academicSubagentContext(input, academicToolSharedState)
            : mysteryWorkspace
              ? mysterySubagentContext(input)
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
