import { runSiteOfficialOperation } from "./site-official-operation";
import {
  AgentProviderRuntimeConfigSchema,
  CommandEnvelopeSchema,
  ModelCapacityResultSchema,
  ModelConnectionTestResultSchema,
  ModelSettingsSchema,
  ModelTestCancelResultSchema,
  ModelUsageDashboardSchema,
  RemoteModelListResultSchema,
  createEnvelope,
  isDeepWriteSiteOfficialModel,
  type AgentRuntimeRef,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { UtilityCommandTimeoutError } from "../supervisor";
import { createUsageModelSnapshot } from "../usage-observation";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import type { ModelTestRegistry } from "./model-test-registry";
import { handleSiteOfficialModelCommands } from "./site-official-model-commands";
import { rejectedResult } from "./errors";

export type ModelCommandContext = Pick<
  IpcCommandContext,
  | "requireModelConfigStore"
  | "requireModelUsageStore"
  | "listRemoteModels"
  | "supervisor"
> & {
  remoteFetch?: (input: string, init?: RequestInit) => Promise<Response>;
  ownerId?: number;
  modelTestRegistry?: ModelTestRegistry;
};

async function sendAgentModelTestCancel(
  ctx: ModelCommandContext,
  requestId: string,
  context: CommandEnvelope["context"]
): Promise<boolean> {
  const cancelCommand = CommandEnvelopeSchema.parse(
    createEnvelope(
      "agent.model_test_cancel",
      { requestId },
      { id: createId("cmd_agent_model_test_cancel"), context }
    )
  );
  const result = await ctx.supervisor.requestCommand(
    "agent",
    cancelCommand,
    5_000
  );
  return result.status === "accepted"
    ? ModelTestCancelResultSchema.parse(result.payload).cancelled
    : false;
}

async function dispatchModelCommand(
  ctx: ModelCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  const siteOfficialResult = await handleSiteOfficialModelCommands(
    ctx,
    command
  );
  if (siteOfficialResult) return siteOfficialResult;

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
      return rejectedResult(
        command.id,
        "models.list_failed",
        error instanceof Error ? error.message : "加载模型配置失败。",
        safeErrorDetails(error)
      );
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
      return rejectedResult(
        command.id,
        "models.refresh_free_failed",
        error instanceof Error ? error.message : "刷新免费模型配置失败。",
        safeErrorDetails(error)
      );
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
      return rejectedResult(
        command.id,
        "models.set_free_model_enabled_failed",
        error instanceof Error ? error.message : "更新免费模型启用状态失败。",
        safeErrorDetails(error)
      );
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
      return rejectedResult(
        command.id,
        "model_usage.query_failed",
        error instanceof Error ? error.message : "加载模型用量失败。",
        safeErrorDetails(error)
      );
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
      return rejectedResult(
        command.id,
        "models.save_failed",
        error instanceof Error ? error.message : "保存模型配置失败。",
        safeErrorDetails(error)
      );
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
      return rejectedResult(
        command.id,
        "models.list_remote_failed",
        error instanceof Error ? error.message : "拉取可用模型失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "models.cancelTest") {
    try {
      const cancelled = ctx.modelTestRegistry
        ? await ctx.modelTestRegistry.cancel(
            command.payload.requestId,
            ctx.ownerId,
            (requestId) =>
              sendAgentModelTestCancel(ctx, requestId, command.context)
          )
        : await sendAgentModelTestCancel(
            ctx,
            command.payload.requestId,
            command.context
          );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ModelTestCancelResultSchema.parse({ cancelled })
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "models.cancel_test_failed",
        error instanceof Error ? error.message : "取消模型连接测试失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "models.test") {
    const testRequestId = command.payload.requestId ?? command.id;
    const registry = ctx.modelTestRegistry;
    if (registry && !registry.begin(testRequestId, ctx.ownerId)) {
      return rejectedResult(
        command.id,
        "models.test_duplicate_request",
        "该模型连接测试请求已在进行中。"
      );
    }
    try {
      const runtimeConfig = await ctx
        .requireModelConfigStore()
        .resolveDraft(command.payload.model);
      if (registry?.isCancelled(testRequestId)) {
        return rejectedResult(
          command.id,
          "models.test_cancelled",
          "模型连接测试已取消。"
        );
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.model_test",
          {
            runtimeConfig,
            ...(command.payload.requestId !== undefined
              ? { requestId: command.payload.requestId }
              : {})
          },
          { id: command.id, context: command.context }
        )
      );
      registry?.markDispatched(testRequestId);
      let result: CommandResult;
      try {
        result = await ctx.supervisor.requestCommand(
          "agent",
          internalCommand,
          20_000
        );
      } catch (error: unknown) {
        if (registry?.isCancelled(testRequestId)) {
          return rejectedResult(
            command.id,
            "models.test_cancelled",
            "模型连接测试已取消。"
          );
        }
        if (error instanceof UtilityCommandTimeoutError) {
          void sendAgentModelTestCancel(
            ctx,
            testRequestId,
            command.context
          ).catch(() => undefined);
          return rejectedResult(
            command.id,
            "models.test_timeout",
            "模型连接超时，请检查网络或稍后重试。",
            safeErrorDetails(error)
          );
        }
        throw error;
      }
      if (registry?.isCancelled(testRequestId)) {
        return rejectedResult(
          command.id,
          "models.test_cancelled",
          "模型连接测试已取消。"
        );
      }
      if (result.status === "accepted") {
        const payload = ModelConnectionTestResultSchema.parse(result.payload);
        if (
          payload.supportsDeveloperRole === false &&
          !command.payload.model.managedBy &&
          !isDeepWriteSiteOfficialModel(command.payload.model)
        ) {
          await ctx
            .requireModelConfigStore()
            .disableDeveloperRole?.(command.payload.model.id, {
              provider: runtimeConfig.provider,
              modelId: runtimeConfig.modelId,
              api: runtimeConfig.api,
              baseUrl: runtimeConfig.baseUrl
            })
            .catch(() => undefined);
        }
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
      return rejectedResult(
        command.id,
        "models.test_failed",
        error instanceof Error ? error.message : "模型连接测试失败。",
        safeErrorDetails(error)
      );
    } finally {
      registry?.finish(testRequestId);
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
      return rejectedResult(
        command.id,
        "models.resolve_capacity_failed",
        error instanceof Error ? error.message : "读取模型实际请求容量失败。",
        safeErrorDetails(error)
      );
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
