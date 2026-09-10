import { handleAgentTeamCommands } from "./agent-team-commands";
import {
  ChatAssistantProjectConfigListSchema,
  ChatAssistantProjectConfigSchema,
  GeneralSettingsSnapshotSchema,
  LearningImitationSettingsSchema,
  LibraryAgentSettingsSchema,
  LongAgentSettingsSchema,
  WorkspaceAgentSettingsSchema,
  WorkspaceDirectorySettingsSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import { handleAppearanceCommands } from "./appearance-commands";

export async function handleSettingsCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "workspaceDirectory.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: WorkspaceDirectorySettingsSchema.parse(
          await ctx.requireWorkspaceDirectoryStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "workspace_directory.list_failed",
          message:
            error instanceof Error ? error.message : "加载工作目录失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "workspaceDirectory.choose") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: await ctx.chooseWorkspaceDirectory()
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "workspace_directory.choose_failed",
          message:
            error instanceof Error ? error.message : "切换工作目录失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  const appearanceResult = await handleAppearanceCommands(ctx, command);
  if (appearanceResult) {
    return appearanceResult;
  }

  if (command.type === "generalSettings.list") {
    try {
      const snapshot = GeneralSettingsSnapshotSchema.parse(
        await ctx.requireGeneralSettingsStore().list()
      );
      ctx.syncGeneralSettings(snapshot.settings);
      return {
        status: "accepted",
        requestId: command.id,
        payload: snapshot
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "general_settings.list_failed",
          message:
            error instanceof Error ? error.message : "加载常规设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "generalSettings.save") {
    try {
      const snapshot = GeneralSettingsSnapshotSchema.parse(
        await ctx.requireGeneralSettingsStore().save(command.payload)
      );
      ctx.syncGeneralSettings(snapshot.settings);
      return {
        status: "accepted",
        requestId: command.id,
        payload: snapshot
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "general_settings.save_failed",
          message:
            error instanceof Error ? error.message : "保存常规设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "workspaceAgents.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: WorkspaceAgentSettingsSchema.parse(
          await ctx
            .requireWorkspaceAgentConfigStore()
            .list(command.payload.workspaceType)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "workspace_agents.list_failed",
          message:
            error instanceof Error
              ? error.message
              : "加载创作空间智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  const teamResult = await handleAgentTeamCommands(ctx, command);
  if (teamResult) return teamResult;
  if (command.type === "workspaceAgents.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: WorkspaceAgentSettingsSchema.parse(
          await ctx.requireWorkspaceAgentConfigStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "workspace_agents.save_failed",
          message:
            error instanceof Error
              ? error.message
              : "保存创作空间智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "workspaceAgents.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: WorkspaceAgentSettingsSchema.parse(
          await ctx
            .requireWorkspaceAgentConfigStore()
            .reset(command.payload.workspaceType, command.payload.agentId)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "workspace_agents.reset_failed",
          message:
            error instanceof Error
              ? error.message
              : "恢复创作空间默认设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "longAgents.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongAgentSettingsSchema.parse(
          await ctx.requireLongAgentConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long_agents.list_failed",
          message:
            error instanceof Error ? error.message : "加载长篇智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "longAgents.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongAgentSettingsSchema.parse(
          await ctx.requireLongAgentConfigStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long_agents.save_failed",
          message:
            error instanceof Error ? error.message : "保存长篇智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "longAgents.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongAgentSettingsSchema.parse(
          await ctx.requireLongAgentConfigStore().reset(command.payload.agentId)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long_agents.reset_failed",
          message:
            error instanceof Error
              ? error.message
              : "恢复长篇智能体默认设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "libraryAgents.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LibraryAgentSettingsSchema.parse(
          await ctx.requireLibraryAgentConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "library_agents.list_failed",
          message:
            error instanceof Error
              ? error.message
              : "加载资料库智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "libraryAgents.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LibraryAgentSettingsSchema.parse(
          await ctx.requireLibraryAgentConfigStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "library_agents.save_failed",
          message:
            error instanceof Error
              ? error.message
              : "保存资料库智能体设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "libraryAgents.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LibraryAgentSettingsSchema.parse(
          await ctx
            .requireLibraryAgentConfigStore()
            .reset(command.payload.domain)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "library_agents.reset_failed",
          message:
            error instanceof Error
              ? error.message
              : "恢复资料库智能体默认设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "learningImitationSettings.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LearningImitationSettingsSchema.parse(
          await ctx.requireLearningImitationConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "learning_imitation_settings.list_failed",
          message:
            error instanceof Error ? error.message : "加载学习仿写设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "learningImitationSettings.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LearningImitationSettingsSchema.parse(
          await ctx.requireLearningImitationConfigStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "learning_imitation_settings.save_failed",
          message:
            error instanceof Error ? error.message : "保存学习仿写设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "learningImitationSettings.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LearningImitationSettingsSchema.parse(
          await ctx
            .requireLearningImitationConfigStore()
            .reset(command.payload.stageId)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "learning_imitation_settings.reset_failed",
          message:
            error instanceof Error
              ? error.message
              : "恢复学习仿写默认设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (
    command.type === "chatAssistantProjectConfig.list" ||
    command.type === "chatAssistantProjectConfig.get" ||
    command.type === "chatAssistantProjectConfig.save" ||
    command.type === "chatAssistantProjectConfig.reset"
  ) {
    try {
      const store = ctx.requireChatAssistantProjectConfigStore();
      const payload =
        command.type === "chatAssistantProjectConfig.list"
          ? await store.list()
          : command.type === "chatAssistantProjectConfig.get"
            ? await store.get(command.payload)
            : command.type === "chatAssistantProjectConfig.save"
              ? await store.save(
                  command.payload.project,
                  command.payload.systemPrompt
                )
              : await store.reset(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload:
          command.type === "chatAssistantProjectConfig.list"
            ? ChatAssistantProjectConfigListSchema.parse(payload)
            : ChatAssistantProjectConfigSchema.parse(payload)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "chat_assistant_project_config.failed",
          message:
            error instanceof Error
              ? error.message
              : "处理聊天助手项目配置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
