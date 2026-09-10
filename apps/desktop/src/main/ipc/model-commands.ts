import { runSiteOfficialOperation } from "./site-official-operation";
import {
  AgentProviderRuntimeConfigSchema,
  CommandEnvelopeSchema,
  ModelCapacityResultSchema,
  ModelConnectionTestResultSchema,
  ModelSettingsSchema,
  ModelUsageDashboardSchema,
  RemoteModelListResultSchema,
  createEnvelope,
  type AgentRuntimeRef,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createUsageModelSnapshot } from "../usage-observation";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import { handleOfficialModelCommands } from "./official-model-commands";
import { handleSiteOfficialModelCommands } from "./site-official-model-commands";

export type ModelCommandContext = Pick<
  IpcCommandContext,
  | "requireModelConfigStore"
  | "requireModelUsageStore"
  | "listRemoteModels"
  | "supervisor"
> & {
  remoteFetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

async function dispatchModelCommand(
  ctx: ModelCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  const siteOfficialResult = await handleSiteOfficialModelCommands(
    ctx,
    command
  );
  if (siteOfficialResult) return siteOfficialResult;
  const officialResult = await handleOfficialModelCommands(ctx, command);
  if (officialResult) return officialResult;

  if (command.type === "models.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ModelSettingsSchema.parse(
          await ctx.requireModelConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.list_failed",
          message:
            error instanceof Error ? error.message : "加载模型配置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.refreshFree") {
    try {
      const settings = ModelSettingsSchema.parse(
        await ctx.requireModelConfigStore().refreshFreeModels()
      );
      await ctx.requireModelUsageStore().syncConfiguredModels(settings.models);
      return {
        status: "accepted",
        requestId: command.id,
        payload: settings
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.refresh_free_failed",
          message:
            error instanceof Error ? error.message : "刷新免费模型配置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.setFreeModelEnabled") {
    try {
      const settings = ModelSettingsSchema.parse(
        await ctx
          .requireModelConfigStore()
          .setFreeModelEnabled(command.payload.modelId, command.payload.enabled)
      );
      await ctx.requireModelUsageStore().syncConfiguredModels(settings.models);
      return {
        status: "accepted",
        requestId: command.id,
        payload: settings
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.set_free_model_enabled_failed",
          message:
            error instanceof Error
              ? error.message
              : "更新免费模型启用状态失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "modelUsage.query") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ModelUsageDashboardSchema.parse(
          await ctx.requireModelUsageStore().query(command.payload)
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "model_usage.query_failed",
          message:
            error instanceof Error ? error.message : "加载模型用量失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.save") {
    try {
      const settings = ModelSettingsSchema.parse(
        await ctx.requireModelConfigStore().save(command.payload)
      );
      void ctx
        .requireModelUsageStore()
        .syncConfiguredModels(settings.models)
        .catch((error: unknown) => {
          console.warn(
            "DeepWrite model usage registry was not synchronized:",
            error instanceof Error ? error.message : "unknown error"
          );
        });
      return {
        status: "accepted",
        requestId: command.id,
        payload: settings
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.save_failed",
          message:
            error instanceof Error ? error.message : "保存模型配置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.listRemote") {
    try {
      const apiKey = await ctx.requireModelConfigStore().resolveDraftApiKey({
        ...(command.payload.id ? { id: command.payload.id } : {}),
        ...(command.payload.apiKey ? { apiKey: command.payload.apiKey } : {}),
        ...(command.payload.clearApiKey ? { clearApiKey: true } : {})
      });
      const models = await ctx.listRemoteModels({
        provider: command.payload.provider,
        api: command.payload.api,
        baseUrl: command.payload.baseUrl,
        apiKey
      });
      return {
        status: "accepted",
        requestId: command.id,
        payload: RemoteModelListResultSchema.parse({ models })
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.list_remote_failed",
          message:
            error instanceof Error ? error.message : "拉取可用模型失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.test") {
    try {
      const runtimeConfig = await ctx
        .requireModelConfigStore()
        .resolveDraft(command.payload.model);
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.model_test",
          { runtimeConfig },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        20_000
      );
      if (result.status === "accepted") {
        const payload = ModelConnectionTestResultSchema.parse(result.payload);
        if (payload.usage) {
          const runtime: AgentRuntimeRef = {
            provider: runtimeConfig.provider,
            model: runtimeConfig.modelId,
            mode: "provider",
            configId: runtimeConfig.id
          };
          void ctx
            .requireModelUsageStore()
            .record({
              id: `v2:model-test:${command.id}`,
              occurredAt: payload.testedAt,
              model: createUsageModelSnapshot(runtime, runtimeConfig),
              module: "model-test",
              actor: "connection-test",
              status: "completed",
              usage: payload.usage
            })
            .catch((error: unknown) => {
              console.warn(
                "DeepWrite model-test usage was not persisted:",
                error instanceof Error ? error.message : "unknown error"
              );
            });
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      }
      return result;
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.test_failed",
          message:
            error instanceof Error ? error.message : "模型连接测试失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "models.resolveCapacity") {
    try {
      // Capacity resolution only reads model metadata. Keep this path free of
      // stored credentials so a missing login, locked safe storage, or broken
      // API key cannot prevent the UI from showing the model's context window.
      const runtimeConfig = AgentProviderRuntimeConfigSchema.parse({
        ...command.payload.model,
        apiKey: ""
      });
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.model_capacity",
          { runtimeConfig },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status === "accepted") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: ModelCapacityResultSchema.parse(result.payload)
        };
      }
      return result;
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "models.resolve_capacity_failed",
          message:
            error instanceof Error
              ? error.message
              : "读取模型实际请求容量失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}

export async function handleModelCommands(
  ctx: ModelCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("models."))
    return dispatchModelCommand(ctx, command);
  return runSiteOfficialOperation(ctx.requireModelConfigStore(), command, () =>
    dispatchModelCommand(ctx, command)
  );
}
