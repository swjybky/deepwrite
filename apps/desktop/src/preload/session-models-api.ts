import {
  ChatAssistantProjectConfigListSchema,
  ChatAssistantProjectConfigSchema,
  ChatAssistantProjectRefSchema,
  ModelCapacityResultSchema,
  ModelConfigInputSchema,
  ModelConnectionTestResultSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  ModelUsageDashboardSchema,
  ModelUsageQueryInputSchema,
  OfficialModelBalanceSchema,
  RemoteModelListInputSchema,
  RemoteModelListResultSchema,
  SiteOfficialQuotaSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionAbortCommandPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  SessionUserInputResponsePayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  createEnvelope,
  type ChatAssistantProjectConfig,
  type ChatAssistantProjectRef,
  type DeepWriteApi,
  type ModelCapacityResult,
  type ModelConfigInput,
  type ModelConnectionTestResult,
  type ModelSettings,
  type ModelSettingsInput,
  type ModelUsageDashboard,
  type ModelUsageQueryInput,
  type RemoteModelListInput,
  type RemoteModelListResult,
  type SessionAbortAcceptedPayload,
  type SessionAbortCommandPayload,
  type SessionUserInputResponseAcceptedPayload,
  type SessionUserInputResponsePayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

export async function prompt(
  rawPayload: SessionPromptCommandPayload
): Promise<SessionPromptAcceptedPayload> {
  const payload = SessionPromptCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_prompt");
  const resourceId = payload.workspaceContext?.activeResource?.id;
  const accepted = SessionPromptAcceptedPayloadSchema.parse(
    await invokeCommand<SessionPromptAcceptedPayload>(
      createEnvelope("session.prompt", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          ...(resourceId ? { resourceId } : {})
        }
      })
    )
  );
  if (accepted.sessionId !== payload.sessionId) {
    throw new Error(
      "Agent acceptance sessionId does not match the prompt request."
    );
  }
  return accepted;
}

export async function abort(
  rawPayload: SessionAbortCommandPayload
): Promise<SessionAbortAcceptedPayload> {
  const payload = SessionAbortCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_abort");
  return SessionAbortAcceptedPayloadSchema.parse(
    await invokeCommand<SessionAbortAcceptedPayload>(
      createEnvelope("session.abort", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    )
  );
}

export async function submitUserInput(
  rawPayload: SessionUserInputResponsePayload
): Promise<SessionUserInputResponseAcceptedPayload> {
  const payload = SessionUserInputResponsePayloadSchema.parse(rawPayload);
  const id = browserId("cmd_user_input");
  return SessionUserInputResponseAcceptedPayloadSchema.parse(
    await invokeCommand<SessionUserInputResponseAcceptedPayload>(
      createEnvelope("session.user_input_response", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    )
  );
}

export async function listModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_list");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.list", {}, { id, correlationId: id })
    )
  );
}

export async function refreshFreeModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_refresh_free");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.refreshFree", {}, { id, correlationId: id })
    )
  );
}

export async function setFreeModelEnabled(
  modelId: string,
  enabled: boolean
): Promise<ModelSettings> {
  const id = browserId("cmd_models_set_free_enabled");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.setFreeModelEnabled",
        { modelId, enabled },
        { id, correlationId: id }
      )
    )
  );
}

export async function refreshOfficialModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_refresh_official");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.refreshOfficial", {}, { id, correlationId: id })
    )
  );
}

export async function queryOfficialModelBalance() {
  const id = browserId("cmd_models_query_official_balance");
  return OfficialModelBalanceSchema.parse(
    await invokeCommand(
      createEnvelope(
        "models.queryOfficialBalance",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function saveOfficialModelToken(
  rawApiKey: string
): Promise<ModelSettings> {
  const apiKey = rawApiKey.trim();
  if (!apiKey || apiKey.length > 16_000) {
    throw new Error("请输入有效的官方令牌。");
  }
  const id = browserId("cmd_models_save_official_token");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.saveOfficialToken",
        { apiKey },
        { id, correlationId: id }
      )
    )
  );
}

export async function clearOfficialModelToken(): Promise<ModelSettings> {
  const id = browserId("cmd_models_clear_official_token");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.clearOfficialToken", {}, { id, correlationId: id })
    )
  );
}

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

export async function setOfficialModelEnabled(
  modelId: string,
  enabled: boolean
): Promise<ModelSettings> {
  const id = browserId("cmd_models_set_official_enabled");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope(
        "models.setOfficialModelEnabled",
        { modelId, enabled },
        { id, correlationId: id }
      )
    )
  );
}

export async function saveModels(
  rawSettings: ModelSettingsInput
): Promise<ModelSettings> {
  const settings = ModelSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_models_save");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.save", settings, { id, correlationId: id })
    )
  );
}

export async function testModel(
  rawModel: ModelConfigInput
): Promise<ModelConnectionTestResult> {
  const model = ModelConfigInputSchema.parse(rawModel);
  const id = browserId("cmd_models_test");
  return ModelConnectionTestResultSchema.parse(
    await invokeCommand<ModelConnectionTestResult>(
      createEnvelope("models.test", { model }, { id, correlationId: id })
    )
  );
}

export async function resolveModelCapacity(
  rawModel: ModelConfigInput
): Promise<ModelCapacityResult> {
  const model = ModelConfigInputSchema.parse(rawModel);
  const id = browserId("cmd_models_resolve_capacity");
  return ModelCapacityResultSchema.parse(
    await invokeCommand<ModelCapacityResult>(
      createEnvelope(
        "models.resolveCapacity",
        { model },
        { id, correlationId: id }
      )
    )
  );
}

export async function listRemoteModels(
  rawInput: RemoteModelListInput
): Promise<RemoteModelListResult> {
  const input = RemoteModelListInputSchema.parse(rawInput);
  const id = browserId("cmd_models_list_remote");
  return RemoteModelListResultSchema.parse(
    await invokeCommand<RemoteModelListResult>(
      createEnvelope("models.listRemote", input, { id, correlationId: id })
    )
  );
}

export async function queryModelUsage(
  rawInput: ModelUsageQueryInput = {}
): Promise<ModelUsageDashboard> {
  const input = ModelUsageQueryInputSchema.parse(rawInput);
  const id = browserId("cmd_model_usage_query");
  return ModelUsageDashboardSchema.parse(
    await invokeCommand<ModelUsageDashboard>(
      createEnvelope("modelUsage.query", input, { id, correlationId: id })
    )
  );
}

export async function getChatAssistantProjectConfig(
  rawProject: ChatAssistantProjectRef
): Promise<ChatAssistantProjectConfig> {
  const project = ChatAssistantProjectRefSchema.parse(rawProject);
  const id = browserId("cmd_chat_assistant_project_config_get");
  return ChatAssistantProjectConfigSchema.parse(
    await invokeCommand<ChatAssistantProjectConfig>(
      createEnvelope("chatAssistantProjectConfig.get", project, {
        id,
        correlationId: id
      })
    )
  );
}

export async function listChatAssistantProjectConfigs(): Promise<
  ChatAssistantProjectRef[]
> {
  const id = browserId("cmd_chat_assistant_project_config_list");
  return ChatAssistantProjectConfigListSchema.parse(
    await invokeCommand<ChatAssistantProjectRef[]>(
      createEnvelope(
        "chatAssistantProjectConfig.list",
        {},
        {
          id,
          correlationId: id
        }
      )
    )
  );
}

export async function saveChatAssistantProjectConfig(
  rawProject: ChatAssistantProjectRef,
  rawSystemPrompt: string
): Promise<ChatAssistantProjectConfig> {
  const project = ChatAssistantProjectRefSchema.parse(rawProject);
  const systemPrompt = String(rawSystemPrompt);
  const id = browserId("cmd_chat_assistant_project_config_save");
  return ChatAssistantProjectConfigSchema.parse(
    await invokeCommand<ChatAssistantProjectConfig>(
      createEnvelope(
        "chatAssistantProjectConfig.save",
        { project, systemPrompt },
        { id, correlationId: id }
      )
    )
  );
}

export async function resetChatAssistantProjectConfig(
  rawProject: ChatAssistantProjectRef
): Promise<ChatAssistantProjectConfig> {
  const project = ChatAssistantProjectRefSchema.parse(rawProject);
  const id = browserId("cmd_chat_assistant_project_config_reset");
  return ChatAssistantProjectConfigSchema.parse(
    await invokeCommand<ChatAssistantProjectConfig>(
      createEnvelope("chatAssistantProjectConfig.reset", project, {
        id,
        correlationId: id
      })
    )
  );
}

export const session: DeepWriteApi["session"] = {
  prompt,
  abort,
  submitUserInput
};

export const models: DeepWriteApi["models"] = {
  list: listModels,
  refreshFree: refreshFreeModels,
  setFreeModelEnabled,
  refreshOfficial: refreshOfficialModels,
  queryOfficialBalance: queryOfficialModelBalance,
  saveOfficialToken: saveOfficialModelToken,
  clearOfficialToken: clearOfficialModelToken,
  saveSiteOfficialToken: saveSiteOfficialModelToken,
  clearSiteOfficialToken: clearSiteOfficialModelToken,
  refreshSiteOfficial: refreshSiteOfficialModels,
  querySiteOfficialQuota,
  setSiteOfficialModelEnabled,
  setOfficialModelEnabled,
  save: saveModels,
  test: testModel,
  resolveCapacity: resolveModelCapacity,
  listRemote: listRemoteModels
};

export const modelUsage: DeepWriteApi["modelUsage"] = {
  query: queryModelUsage
};

export const chatAssistantProjectConfig: NonNullable<
  DeepWriteApi["chatAssistantProjectConfig"]
> = {
  list: listChatAssistantProjectConfigs,
  get: getChatAssistantProjectConfig,
  save: saveChatAssistantProjectConfig,
  reset: resetChatAssistantProjectConfig
};
