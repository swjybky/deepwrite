import {
  ModelSettingsSchema,
  OfficialModelBalanceSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

type OfficialModelCommandContext = Pick<
  IpcCommandContext,
  "requireModelConfigStore" | "requireModelUsageStore"
>;

function rejected(
  command: CommandEnvelope,
  code: string,
  fallback: string,
  error: unknown
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: {
      code,
      message: error instanceof Error ? error.message : fallback,
      details: safeErrorDetails(error)
    }
  };
}

export async function handleOfficialModelCommands(
  ctx: OfficialModelCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "models.queryOfficialBalance") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: OfficialModelBalanceSchema.parse(
          await ctx.requireModelConfigStore().queryOfficialBalance()
        )
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.query_official_balance_failed",
        "查询官方模型余额失败。",
        error
      );
    }
  }

  if (
    command.type !== "models.refreshOfficial" &&
    command.type !== "models.saveOfficialToken" &&
    command.type !== "models.clearOfficialToken" &&
    command.type !== "models.setOfficialModelEnabled"
  ) {
    return undefined;
  }

  const store = ctx.requireModelConfigStore();
  try {
    const rawSettings =
      command.type === "models.refreshOfficial"
        ? await store.refreshOfficialModels()
        : command.type === "models.saveOfficialToken"
          ? await store.saveOfficialToken(command.payload.apiKey)
          : command.type === "models.clearOfficialToken"
            ? await store.clearOfficialToken()
            : command.type === "models.setOfficialModelEnabled"
              ? await store.setOfficialModelEnabled(
                  command.payload.modelId,
                  command.payload.enabled
                )
              : undefined;
    if (!rawSettings) return undefined;
    const settings = ModelSettingsSchema.parse(rawSettings);
    await ctx.requireModelUsageStore().syncConfiguredModels(settings.models);
    return { status: "accepted", requestId: command.id, payload: settings };
  } catch (error: unknown) {
    if (command.type === "models.refreshOfficial") {
      return rejected(
        command,
        "models.refresh_official_failed",
        "刷新官方模型配置失败。",
        error
      );
    }
    if (command.type === "models.saveOfficialToken") {
      return rejected(
        command,
        "models.save_official_token_failed",
        "保存官方令牌失败。",
        error
      );
    }
    if (command.type === "models.clearOfficialToken") {
      return rejected(
        command,
        "models.clear_official_token_failed",
        "移除官方令牌失败。",
        error
      );
    }
    if (command.type === "models.setOfficialModelEnabled") {
      return rejected(
        command,
        "models.set_official_model_enabled_failed",
        "更新官方模型启用状态失败。",
        error
      );
    }
    throw error;
  }
}
