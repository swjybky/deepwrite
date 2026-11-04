import { acquireConversationOperation } from "./conversation-operation-guard";
import { createId } from "@deepwrite/shared";
import { resolveAgentTeamRuntime } from "../agent-team-run-mode";
import { prepareLibraryManagementRunContext } from "../library-management-run-context";
import { prepareMaterialRunContext } from "../material-run-context";
import {
  CommandEnvelopeSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  conversationPromptBudgetError,
  subagentsNeedWebSearch,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  resolveContextCompactionRun,
  withCompactionUsageConfig
} from "../context-compaction-run";
import { resolveModelRunSettings } from "../model-run-settings";
import { createUsageRunContext } from "../usage-observation";
import { usageModuleForPrompt } from "../usage-module";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import { handleSessionRunControlCommands } from "./session-run-control-commands";

export async function handleSessionCommands(
  ctx: Pick<
    IpcCommandContext,
    | "activeRuns"
    | "supervisor"
    | "pendingUsageContexts"
    | "terminalRuns"
    | "requireModelConfigStore"
    | "requireWorkspaceAgentConfigStore"
    | "requireLongAgentConfigStore"
    | "requireAgentTeamConfigStore"
    | "requireLibraryAgentConfigStore"
    | "requireGeneralSettingsStore"
    | "resolveWebSearch"
  >,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  const runControl = await handleSessionRunControlCommands(ctx, command);
  if (runControl) return runControl;

  if (command.type === "session.prompt") {
    const ownerId = createId("prompt");
    const release = acquireConversationOperation(
      ctx.activeRuns,
      command.payload.sessionId,
      "prompt",
      ownerId
    );
    if (!release)
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.session_busy",
          message: "此对话仍在运行或管理历史，请稍后重试。"
        }
      };
    let keepOwnership = false;
    try {
      const runtimeConfig = await ctx
        .requireModelConfigStore()
        .resolve(command.payload.modelId);
      const shortWorkspace = command.payload.workspaceContext?.shortWorkspace;
      const scriptWorkspace = command.payload.workspaceContext?.scriptWorkspace;
      const longWorkspace = command.payload.workspaceContext?.longWorkspace;
      const libraryWorkspace =
        command.payload.workspaceContext?.libraryWorkspace;
      const creativeWorkspace = shortWorkspace ?? scriptWorkspace;
      const creativeWorkspaceType = scriptWorkspace ? "script" : "short";
      const agentProfile = creativeWorkspace
        ? await ctx
            .requireWorkspaceAgentConfigStore()
            .resolveForWorkspace(creativeWorkspace, creativeWorkspaceType)
        : undefined;
      const longAgentProfile = longWorkspace
        ? await ctx
            .requireLongAgentConfigStore()
            .resolve(longWorkspace.activeAgentId)
        : undefined;
      const { subagentDefinitions, subagentRuntimeConfigs, parallelSubagents } =
        await resolveAgentTeamRuntime(
          command.payload.agentTeamMode,
          agentProfile
            ? {
                workspaceType: creativeWorkspaceType,
                parentAgentId: agentProfile.id,
                ...(creativeWorkspace ? { bookId: creativeWorkspace.id } : {})
              }
            : longAgentProfile
              ? {
                  workspaceType: "long",
                  parentAgentId: longAgentProfile.id,
                  ...(longWorkspace ? { bookId: longWorkspace.bookId } : {})
                }
              : undefined,
          {
            resolveDefinitions: (workspaceType, parentAgentId, bookId) =>
              ctx
                .requireAgentTeamConfigStore()
                .resolve(workspaceType, parentAgentId, bookId),
            resolveModel: (modelId) =>
              ctx.requireModelConfigStore().resolve(modelId),
            resolveParallelSubagents: (workspaceType, bookId) =>
              ctx
                .requireAgentTeamConfigStore()
                .parallelSubagentsEnabled(workspaceType, bookId)
          }
        );
      // Search exists for the run when the user switched it on or a member asks
      // for it; the search settings still decide whether it can be given.
      const webSearch =
        command.payload.webSearchEnabled === true ||
        subagentsNeedWebSearch(subagentDefinitions)
          ? await ctx.resolveWebSearch?.()
          : undefined;
      const libraryAgentProfile = libraryWorkspace
        ? await ctx
            .requireLibraryAgentConfigStore()
            .resolve(libraryWorkspace.domain)
        : undefined;
      const { thinkingLevel, temperature } = resolveModelRunSettings(
        runtimeConfig,
        {
          thinkingLevel: command.payload.thinkingLevel,
          temperature: command.payload.temperature
        }
      );
      const {
        agentTeamMode: _requestedAgentTeamMode,
        thinkingLevel: _requestedThinkingLevel,
        temperature: _requestedTemperature,
        ...promptPayload
      } = command.payload;
      const compaction = await resolveContextCompactionRun(
        async () => (await ctx.requireGeneralSettingsStore().list()).settings,
        (modelId) => ctx.requireModelConfigStore().resolve(modelId),
        runtimeConfig?.id
      );
      const promptError = conversationPromptBudgetError(
        command.payload,
        compaction.contextCompactionSettings.budgetTokens
      );
      if (promptError)
        return {
          status: "rejected",
          requestId: command.id,
          error: promptError
        };
      const usageContext = createUsageRunContext(
        usageModuleForPrompt(command.payload),
        runtimeConfig,
        withCompactionUsageConfig(subagentRuntimeConfigs, compaction)
      );
      ctx.pendingUsageContexts.set(command.context.correlationId, usageContext);
      const libraryManagement = await prepareLibraryManagementRunContext(
        command.payload.workspaceContext,
        ctx.requireAgentTeamConfigStore(),
        ctx.requireLibraryAgentConfigStore(),
        (query) => ctx.supervisor.requestCommand("core", query, 60_000)
      );
      const materialWorkspaceContext = await prepareMaterialRunContext(
        {
          workspaceContext: command.payload.workspaceContext,
          ...(agentProfile ? { agentProfile } : {}),
          ...(longAgentProfile ? { longAgentProfile } : {}),
          snapshotMode: process.env.DEEPWRITE_MATERIAL_SNAPSHOT_MODE === "1"
        },
        (query) => ctx.supervisor.requestCommand("core", query, 60_000)
      );
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.prompt",
          {
            ...promptPayload,
            ...(libraryManagement ? { libraryManagement } : {}),
            ...(materialWorkspaceContext
              ? { workspaceContext: materialWorkspaceContext }
              : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(runtimeConfig ? { runtimeConfig } : {}),
            ...(webSearch ? { webSearch } : {}),
            ...compaction,
            ...(agentProfile
              ? scriptWorkspace
                ? { scriptAgentProfile: agentProfile }
                : { agentProfile }
              : {}),
            ...(longAgentProfile ? { longAgentProfile } : {}),
            ...(subagentDefinitions ? { subagentDefinitions } : {}),
            ...(parallelSubagents ? { parallelSubagents } : {}),
            ...(Object.keys(subagentRuntimeConfigs).length > 0
              ? { subagentRuntimeConfigs }
              : {}),
            ...(libraryAgentProfile ? { libraryAgentProfile } : {})
          },
          { id: ownerId, context: command.context }
        )
      );
      // Once sent, a transport failure cannot prove that Agent did not start.
      keepOwnership = true;
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status === "accepted") {
        const accepted = SessionPromptAcceptedPayloadSchema.parse(
          result.payload
        );
        if (accepted.sessionId !== command.payload.sessionId) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_acceptance",
              message:
                "Agent acceptance sessionId does not match the prompt command."
            }
          };
        }
        const provisional = [...ctx.activeRuns.entries()].find(
          ([, run]) => run.correlationId === command.context.correlationId
        );
        if (provisional && provisional[0] !== accepted.runId) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_acceptance",
              message:
                "Agent acceptance runId does not match the provisional event stream."
            }
          };
        }
        if (!ctx.terminalRuns.has(accepted.runId)) {
          ctx.activeRuns.set(accepted.runId, {
            sessionId: accepted.sessionId,
            externalResourceIds: [
              ...(creativeWorkspace ? [creativeWorkspace.id] : []),
              ...(longWorkspace ? [longWorkspace.bookId] : []),
              ...(libraryWorkspace ? [libraryWorkspace.libraryId] : []),
              ...(libraryManagement?.libraries
                .filter((library) => !library.readOnly)
                .map((library) => library.libraryId) ?? [])
            ],
            correlationId: command.context.correlationId,
            runtime: accepted.runtime,
            accepted: true,
            promptRequestId: internalCommand.id,
            ...(libraryManagement
              ? { libraryManagementScope: libraryManagement.scope }
              : {}),
            ...(materialWorkspaceContext?.materialCatalog
              ? {
                  materialScope: materialWorkspaceContext.materialCatalog.scope
                }
              : {}),
            usageContext,
            ...(longWorkspace ? { resourceId: longWorkspace.bookId } : {})
          });
        }
        ctx.pendingUsageContexts.delete(command.context.correlationId);
        return { status: "accepted", requestId: command.id, payload: accepted };
      }
      ctx.pendingUsageContexts.delete(command.context.correlationId);
      keepOwnership = false;
      return { ...result, requestId: command.id };
    } catch (error: unknown) {
      ctx.pendingUsageContexts.delete(command.context.correlationId);
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_command_failed",
          message:
            error instanceof Error ? error.message : "Agent command failed.",
          details: safeErrorDetails(error)
        }
      };
    } finally {
      if (!keepOwnership) release();
    }
  }
  return undefined;
}
