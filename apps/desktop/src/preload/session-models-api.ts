import { siteOfficialModelsApi } from "./site-official-models-api";
import {
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
  SessionAbortAcceptedPayloadSchema,
  SessionAbortCommandPayloadSchema,
  SessionCompactAcceptedPayloadSchema,
  SessionCompactCommandPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  SessionUserInputResponsePayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  createEnvelope,
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
  type SessionCompactAcceptedPayload,
  type SessionCompactCommandPayload,
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

/**
 * Ask the agent to compact this session's context now, bypassing the automatic
 * threshold. Rejected while a run is streaming.
 */
export async function compact(
  rawPayload: SessionCompactCommandPayload
): Promise<SessionCompactAcceptedPayload> {
  const payload = SessionCompactCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_compact");
  return SessionCompactAcceptedPayloadSchema.parse(
    await invokeCommand<SessionCompactAcceptedPayload>(
      createEnvelope("agent.compact", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          ...(payload.runId ? { runId: payload.runId } : {})
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

export const session: DeepWriteApi["session"] = {
  prompt,
  abort,
  compact,
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
  ...siteOfficialModelsApi,
  setOfficialModelEnabled,
  save: saveModels,
  test: testModel,
  resolveCapacity: resolveModelCapacity,
  listRemote: listRemoteModels
};

export const modelUsage: DeepWriteApi["modelUsage"] = {
  query: queryModelUsage
};
