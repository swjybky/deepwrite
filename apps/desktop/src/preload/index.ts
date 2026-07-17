import { contextBridge, ipcRenderer } from "electron";
import {
  CommandResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  ModelConnectionTestResultSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  createEnvelope,
  type CommandEnvelope,
  type DeepWriteApi,
  type ModelConnectionTestResult,
  type ModelSettings,
  type ModelSettingsInput,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type SystemEventEnvelope,
  type SystemHealthPayload
} from "@deepwrite/contracts";

function browserId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

async function invokeCommand<TPayload>(command: CommandEnvelope): Promise<TPayload> {
  const result = CommandResultSchema.parse(
    await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command)
  );
  if (result.requestId !== command.id) {
    throw new Error("IPC result requestId does not match command id.");
  }
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.payload as TPayload;
}

async function getHealth(): Promise<SystemHealthPayload> {
  const id = browserId("cmd_health");
  return SystemHealthPayloadSchema.parse(
    await invokeCommand<SystemHealthPayload>(
      createEnvelope("system.health", {}, { id, correlationId: id })
    )
  );
}

async function prompt(
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
    throw new Error("Agent acceptance sessionId does not match the prompt request.");
  }
  return accepted;
}

async function listModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_list");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.list", {}, { id, correlationId: id })
    )
  );
}

async function saveModels(rawSettings: ModelSettingsInput): Promise<ModelSettings> {
  const settings = ModelSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_models_save");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.save", settings, { id, correlationId: id })
    )
  );
}

async function testModel(modelId: string): Promise<ModelConnectionTestResult> {
  const id = browserId("cmd_models_test");
  return ModelConnectionTestResultSchema.parse(
    await invokeCommand<ModelConnectionTestResult>(
      createEnvelope("models.test", { modelId }, { id, correlationId: id })
    )
  );
}

const api: DeepWriteApi = {
  system: {
    health: getHealth
  },
  session: {
    prompt
  },
  models: {
    list: listModels,
    save: saveModels,
    test: testModel
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid desktop event.");
          return;
        }
        listener(parsed.data as SystemEventEnvelope);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    }
  }
};

contextBridge.exposeInMainWorld("deepwrite", api);
