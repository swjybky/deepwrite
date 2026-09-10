import {
  ModelSettingsSchema,
  SiteOfficialQuotaSchema,
  SiteOfficialQuotaMergeInputSchema,
  SiteOfficialQuotaMergeResultSchema,
  createEnvelope,
  type ModelSettings,
  type SiteOfficialQuotaMergeInput
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export async function saveSiteOfficialModelToken(
  rawApiKey: string
): Promise<ModelSettings> {
  const apiKey = rawApiKey.trim();
  if (!apiKey || apiKey.length > 16_000) {
    throw new Error("请输入有效的新官方小站模型密钥。");
  }
  const id = browserId("cmd_models_save_site_official_token");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.saveSiteOfficialToken",
        { apiKey },
        { id, correlationId: id }
      )
    )
  );
}

export async function clearSiteOfficialModelToken(): Promise<ModelSettings> {
  const id = browserId("cmd_models_clear_site_official_token");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.clearSiteOfficialToken",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function refreshSiteOfficialModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_refresh_site_official");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.refreshSiteOfficial",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function querySiteOfficialQuota() {
  const id = browserId("cmd_models_query_site_official_quota");
  return SiteOfficialQuotaSchema.parse(
    await invokeCommand(
      createEnvelope(
        "models.querySiteOfficialQuota",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function setSiteOfficialModelEnabled(
  modelId: string,
  enabled: boolean
): Promise<ModelSettings> {
  const id = browserId("cmd_models_set_site_official_enabled");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.setSiteOfficialModelEnabled",
        { modelId, enabled },
        { id, correlationId: id }
      )
    )
  );
}

export async function mergeSiteOfficialQuota(
  rawInput: SiteOfficialQuotaMergeInput
) {
  const input = SiteOfficialQuotaMergeInputSchema.parse(rawInput);
  const id = browserId("cmd_models_merge_site_official_quota");
  return SiteOfficialQuotaMergeResultSchema.parse(
    await invokeCommand(
      createEnvelope("models.mergeSiteOfficialQuota", input, {
        id,
        correlationId: id
      })
    )
  );
}

export const siteOfficialModelsApi = {
  saveSiteOfficialToken: saveSiteOfficialModelToken,
  clearSiteOfficialToken: clearSiteOfficialModelToken,
  refreshSiteOfficial: refreshSiteOfficialModels,
  querySiteOfficialQuota,
  mergeSiteOfficialQuota,
  setSiteOfficialModelEnabled
};
