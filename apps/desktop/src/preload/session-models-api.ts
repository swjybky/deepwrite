import { siteOfficialModelsApi } from "./site-official-models-api";
import {
  ModelCapacityResultSchema,
  ModelConfigInputSchema,
  ModelConnectionTestResultSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  ModelTestCancelInputSchema,
  ModelTestCancelResultSchema,
  ModelTestRequestIdSchema,
  ModelUsageDashboardSchema,
  ModelUsageQueryInputSchema,
  RemoteModelListInputSchema,
  RemoteModelListResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionAbortCommandPayloadSchema,
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
  type ModelTestCancelInput,
  type ModelTestCancelResult,
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
import { steer } from "./session-steer-api";

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
  rawModel: ModelConfigInput,
  options?: { requestId?: string }
): Promise<ModelConnectionTestResult> {
  const model = ModelConfigInputSchema.parse(rawModel);
  const requestId =
    options?.requestId !== undefined
      ? ModelTestRequestIdSchema.parse(options.requestId)
      : undefined;
  const id = browserId("cmd_models_test");
  return ModelConnectionTestResultSchema.parse(
    await invokeCommand<ModelConnectionTestResult>(
      createEnvelope(
        "models.test",
        { model, ...(requestId !== undefined ? { requestId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

export async function cancelModelTest(
  rawInput: ModelTestCancelInput
): Promise<ModelTestCancelResult> {
  const input = ModelTestCancelInputSchema.parse(rawInput);
  const id = browserId("cmd_models_cancel_test");
  return ModelTestCancelResultSchema.parse(
    await invokeCommand<ModelTestCancelResult>(
      createEnvelope("models.cancelTest", input, { id, correlationId: id })
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
  submitUserInput,
  steer
};

export const models: DeepWriteApi["models"] = {
  list: listModels,
  refreshFree: refreshFreeModels,
  setFreeModelEnabled,
  ...siteOfficialModelsApi,
  save: saveModels,
  test: testModel,
  cancelTest: cancelModelTest,
  resolveCapacity: resolveModelCapacity,
  listRemote: listRemoteModels
};

export const modelUsage: DeepWriteApi["modelUsage"] = {
  query: queryModelUsage
};
