import { acquireConversationOperation } from "./conversation-operation-guard";
import { resolveAgentTeamRuntime } from "../agent-team-run-mode";
import { prepareLibraryManagementRunContext } from "../library-management-run-context";
import { prepareMaterialRunContext } from "../material-run-context";
import {
  CommandEnvelopeSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  isDeepSeekWebSearchCompatible,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { resolveChatAssistantRuntimeContext } from "../chat-assistant-runtime-context";
import { resolveModelRunSettings } from "../model-run-settings";
import { createUsageRunContext } from "../usage-observation";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleSessionCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "session.user_input_response") {
    try {
      // activeRuns is a Main-side event-stream mirror and can briefly lag the
      // Agent utility that owns the pending question. Forward the response to
      // that authoritative owner; it validates sessionId, runId, requestId and
      // every answer before resolving the waiting tool call.
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope("agent.user_input_response", command.payload, {
          id: command.id,
          context: command.context
        })
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status !== "accepted") return result;
      const accepted = SessionUserInputResponseAcceptedPayloadSchema.parse(
        result.payload
      );
      if (
        accepted.sessionId !== command.payload.sessionId ||
        accepted.runId !== command.payload.runId ||
        accepted.requestId !== command.payload.requestId
      ) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "ipc.invalid_agent_user_input_result",
            message: "Agent user-input result does not match the request."
          }
        };
      }
      return { status: "accepted", requestId: command.id, payload: accepted };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_user_input_failed",
          message:
            error instanceof Error ? error.message : "提交用户回答失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "session.abort") {
    try {
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope("agent.abort", command.payload, {
          id: command.id,
          context: command.context
        })
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status === "accepted") {
        const accepted = SessionAbortAcceptedPayloadSchema.parse(
          result.payload
        );
        if (
          accepted.sessionId !== command.payload.sessionId ||
          accepted.runId !== command.payload.runId
        ) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_abort_result",
              message: "Agent abort result does not match the requested run."
            }
          };
        }
        return { status: "accepted", requestId: command.id, payload: accepted };
      }
      return result;
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_abort_failed",
          message:
            error instanceof Error ? error.message : "Agent abort failed.",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "session.prompt") {
    const release = acquireConversationOperation(
      ctx.activeRuns,
      command.payload.sessionId,
      "prompt"
    );
    if (!release)
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "conversation_history.busy",
          message: "此对话正在管理历史，请稍后重试。"
        }
      };
    try {
      const runtimeConfig = await ctx
        .requireModelConfigStore()
        .resolve(command.payload.modelId);
      if (command.payload.webSearchEnabled === true) {
        if (!runtimeConfig || !isDeepSeekWebSearchCompatible(runtimeConfig)) {
          throw new Error(
            "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
          );
        }
      }
      const chatAssistantRuntimeContext =
        command.payload.mode === "chat-assistant"
          ? await resolveChatAssistantRuntimeContext(
              ctx.supervisor,
              command.payload,
              {
                requireModelConfigStore: ctx.requireModelConfigStore,
                requireModelUsageStore: ctx.requireModelUsageStore,
                requireChatAssistantProjectConfigStore:
                  ctx.requireChatAssistantProjectConfigStore,
                getAppVersion: ctx.getAppVersion
              }
            )
          : undefined;
      const shortWorkspace = command.payload.workspaceContext?.shortWorkspace;
      const scriptWorkspace = command.payload.workspaceContext?.scriptWorkspace;
      const longWorkspace = command.payload.workspaceContext?.longWorkspace;
      const libraryWorkspace =
        command.payload.workspaceContext?.libraryWorkspace;
      const learningImitation =
        command.payload.workspaceContext?.learningImitation;
      const longBookAnalysis =
        command.payload.workspaceContext?.longBookAnalysis;
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
      const { subagentDefinitions, subagentRuntimeConfigs } =
        await resolveAgentTeamRuntime(
          command.payload.agentTeamMode,
          agentProfile
            ? {
                workspaceType: creativeWorkspaceType,
                parentAgentId: agentProfile.id
              }
            : longAgentProfile
              ? { workspaceType: "long", parentAgentId: longAgentProfile.id }
              : undefined,
          {
            resolveDefinitions: (workspaceType, parentAgentId) =>
              ctx
                .requireAgentTeamConfigStore()
                .resolve(workspaceType, parentAgentId),
            resolveModel: (modelId) =>
              ctx.requireModelConfigStore().resolve(modelId)
          }
        );
      const libraryAgentProfile = libraryWorkspace
        ? await ctx
            .requireLibraryAgentConfigStore()
            .resolve(libraryWorkspace.domain)
        : undefined;
      const learningImitationProfile = learningImitation
        ? await ctx
            .requireLearningImitationConfigStore()
            .resolve(learningImitation.stageId)
        : undefined;
      const longBookAnalysisProfile = longBookAnalysis
        ? await ctx
            .requireLongBookAnalysisConfigStore()
            .resolve(longBookAnalysis.presetId)
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
      const usageContext = createUsageRunContext(
        command.payload,
        runtimeConfig,
        subagentRuntimeConfigs
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
            ...(chatAssistantRuntimeContext
              ? { chatAssistantRuntimeContext }
              : {}),
            ...(agentProfile
              ? scriptWorkspace
                ? { scriptAgentProfile: agentProfile }
                : { agentProfile }
              : {}),
            ...(longAgentProfile ? { longAgentProfile } : {}),
            ...(subagentDefinitions ? { subagentDefinitions } : {}),
            ...(Object.keys(subagentRuntimeConfigs).length > 0
              ? { subagentRuntimeConfigs }
              : {}),
            ...(libraryAgentProfile ? { libraryAgentProfile } : {}),
            ...(learningImitationProfile ? { learningImitationProfile } : {}),
            ...(longBookAnalysisProfile ? { longBookAnalysisProfile } : {})
          },
          { id: command.id, context: command.context }
        )
      );
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
            ...(longWorkspace
              ? { resourceId: longWorkspace.bookId }
              : chatAssistantRuntimeContext?.mode === "project" &&
                  chatAssistantRuntimeContext.project.projectType === "long"
                ? {
                    resourceId: chatAssistantRuntimeContext.project.projectId
                  }
                : {})
          });
        }
        ctx.pendingUsageContexts.delete(command.context.correlationId);
        return { status: "accepted", requestId: command.id, payload: accepted };
      }
      ctx.pendingUsageContexts.delete(command.context.correlationId);
      return result;
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
      release();
    }
  }
  return undefined;
}
