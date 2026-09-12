import {
  mergeDeepWriteSiteOfficialQuota,
  SiteQuotaMergeError
} from "../deepwrite-site-quota-merge";
import {
  siteOfficialOperationState,
  rejectSiteOfficialOperation
} from "./site-official-operation";
import {
  ModelSettingsSchema,
  isDeepWriteSiteOfficialModel,
  type CommandEnvelope,
  type CommandResult,
  type ModelSettings
} from "@deepwrite/contracts";
import {
  clearDeepWriteSiteOfficialModelInput,
  saveDeepWriteSiteOfficialModelInput,
  setDeepWriteSiteOfficialModelEnabledInput
} from "../deepwrite-site-official-model-config";
import { loadDeepWriteSiteOfficialCatalog } from "../deepwrite-site-official-catalog";
import { queryDeepWriteSiteOfficialQuota } from "../deepwrite-site-official-quota";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

type SiteOfficialModelCommandContext = Pick<
  IpcCommandContext,
  "requireModelConfigStore" | "requireModelUsageStore" | "listRemoteModels"
> & {
  remoteFetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

async function resolveConfiguredKey(
  ctx: SiteOfficialModelCommandContext
): Promise<{ current: ModelSettings; apiKey: string }> {
  const store = ctx.requireModelConfigStore();
  const current = await store.list();
  const configured = current.models.find(isDeepWriteSiteOfficialModel);
  if (!configured) throw new Error("请先添加新官方小站模型密钥。");
  const apiKey = await store.resolveDraftApiKey({ id: configured.id });
  if (!apiKey) throw new Error("新官方小站模型密钥不可用，请重新添加。");
  return { current, apiKey };
}

async function syncUsageModels(
  ctx: SiteOfficialModelCommandContext,
  settings: ReturnType<typeof ModelSettingsSchema.parse>
): Promise<void> {
  await ctx.requireModelUsageStore().syncConfiguredModels(settings.models);
}

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

export async function handleSiteOfficialModelCommands(
  ctx: SiteOfficialModelCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "models.saveSiteOfficialToken") {
    try {
      const store = ctx.requireModelConfigStore();
      const [current, catalog] = await Promise.all([
        store.list(),
        loadDeepWriteSiteOfficialCatalog(ctx, command.payload.apiKey)
      ]);
      const settings = ModelSettingsSchema.parse(
        await store.save(
          saveDeepWriteSiteOfficialModelInput(
            current,
            command.payload.apiKey,
            catalog
          )
        )
      );
      await syncUsageModels(ctx, settings);
      return { status: "accepted", requestId: command.id, payload: settings };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.save_site_official_token_failed",
        "保存新官方小站模型密钥失败。",
        error
      );
    }
  }

  if (command.type === "models.refreshSiteOfficial") {
    try {
      const store = ctx.requireModelConfigStore();
      const { current, apiKey } = await resolveConfiguredKey(ctx);
      const catalog = await loadDeepWriteSiteOfficialCatalog(ctx, apiKey);
      const settings = ModelSettingsSchema.parse(
        await store.save(
          saveDeepWriteSiteOfficialModelInput(current, apiKey, catalog)
        )
      );
      await syncUsageModels(ctx, settings);
      return { status: "accepted", requestId: command.id, payload: settings };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.refresh_site_official_failed",
        "刷新新官方小站模型失败。",
        error
      );
    }
  }

  if (command.type === "models.querySiteOfficialQuota") {
    try {
      const state = siteOfficialOperationState(ctx.requireModelConfigStore());
      if (state.busy) throw new SiteQuotaMergeError("models_busy");
      const revision = state.revision;
      const { apiKey } = await resolveConfiguredKey(ctx);
      const quota = await queryDeepWriteSiteOfficialQuota(
        apiKey,
        ctx.remoteFetch
      );
      if (state.revision !== revision || state.busy)
        throw new SiteQuotaMergeError("target_changed");
      return {
        status: "accepted",
        requestId: command.id,
        payload: { ...quota, targetRevision: revision }
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.query_site_official_quota_failed",
        "查询新官方小站额度失败。",
        error
      );
    }
  }

  if (command.type === "models.mergeSiteOfficialQuota") {
    try {
      const state = siteOfficialOperationState(ctx.requireModelConfigStore());
      if (command.payload.targetRevision !== state.revision) {
        throw new SiteQuotaMergeError("target_changed");
      }
      const { apiKey } = await resolveConfiguredKey(ctx);
      const result = await mergeDeepWriteSiteOfficialQuota(
        apiKey,
        command.payload.sourceKey,
        ctx.remoteFetch
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          ...result,
          quota: { ...result.quota, targetRevision: state.revision }
        }
      };
    } catch (error: unknown) {
      return rejectSiteOfficialOperation(command, error);
    }
  }

  if (command.type === "models.setSiteOfficialModelEnabled") {
    try {
      const store = ctx.requireModelConfigStore();
      const current = await store.list();
      const settings = ModelSettingsSchema.parse(
        await store.save(
          setDeepWriteSiteOfficialModelEnabledInput(
            current,
            command.payload.modelId,
            command.payload.enabled
          )
        )
      );
      await syncUsageModels(ctx, settings);
      return { status: "accepted", requestId: command.id, payload: settings };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.set_site_official_model_enabled_failed",
        "更新新官方小站模型启用状态失败。",
        error
      );
    }
  }

  if (command.type === "models.clearSiteOfficialToken") {
    try {
      const store = ctx.requireModelConfigStore();
      const current = await store.list();
      const settings = ModelSettingsSchema.parse(
        await store.save(clearDeepWriteSiteOfficialModelInput(current))
      );
      await syncUsageModels(ctx, settings);
      return { status: "accepted", requestId: command.id, payload: settings };
    } catch (error: unknown) {
      return rejected(
        command,
        "models.clear_site_official_token_failed",
        "移除新官方小站模型密钥失败。",
        error
      );
    }
  }

  return undefined;
}
