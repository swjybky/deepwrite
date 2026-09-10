import {
  IPC_EVENT_CHANNEL,
  RendererStateFlushRequestedEventEnvelopeSchema,
  RendererStateKeySchema,
  RendererStateLoadResultSchema,
  RendererStateMutationResultSchema,
  RendererStateHistoryKeysResultSchema,
  RendererStateHistoryMigrationSchema,
  RendererStateMigrationResultSchema,
  createEnvelope,
  type ConversationPersistenceApi
} from "@deepwrite/contracts";
import { ipcRenderer } from "electron";
import { browserId, invokeCommand } from "./invoke";

async function loadConversationPersistence(
  rawKey: string
): Promise<unknown | undefined> {
  const key = RendererStateKeySchema.parse(rawKey);
  const id = browserId("cmd_renderer_state_load");
  const result = RendererStateLoadResultSchema.parse(
    await invokeCommand(
      createEnvelope("rendererState.load", { key }, { id, correlationId: id })
    )
  );
  return result.found ? result.value : undefined;
}

async function saveConversationPersistence(
  rawKey: string,
  value: unknown
): Promise<void> {
  const key = RendererStateKeySchema.parse(rawKey);
  const id = browserId("cmd_renderer_state_save");
  RendererStateMutationResultSchema.parse(
    await invokeCommand(
      createEnvelope(
        "rendererState.save",
        { key, value },
        { id, correlationId: id }
      )
    )
  );
}

async function removeConversationPersistence(rawKey: string): Promise<void> {
  const key = RendererStateKeySchema.parse(rawKey);
  const id = browserId("cmd_renderer_state_remove");
  RendererStateMutationResultSchema.parse(
    await invokeCommand(
      createEnvelope("rendererState.remove", { key }, { id, correlationId: id })
    )
  );
}

export const conversationPersistence: ConversationPersistenceApi = {
  onBeforeClose(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed =
        RendererStateFlushRequestedEventEnvelopeSchema.safeParse(value);
      if (!parsed.success) return;
      void Promise.resolve()
        .then(handler)
        .then(
          () => true,
          () => false
        )
        .then(async (ok) => {
          const id = browserId("cmd_renderer_state_flushed");
          RendererStateMutationResultSchema.parse(
            await invokeCommand(
              createEnvelope(
                "rendererState.flushCompleted",
                {
                  requestId: parsed.data.id,
                  ok
                },
                { id, correlationId: id }
              )
            )
          );
        })
        .catch(() => undefined);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, listener);
    function setReady(enabled: boolean): void {
      const id = browserId("cmd_renderer_state_flush_ready");
      void invokeCommand(
        createEnvelope(
          "rendererState.flushReady",
          { enabled },
          { id, correlationId: id }
        )
      )
        .then((result) => RendererStateMutationResultSchema.parse(result))
        .catch(() => undefined);
    }
    setReady(true);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNEL, listener);
      setReady(false);
    };
  },
  load: loadConversationPersistence,
  save: saveConversationPersistence,
  remove: removeConversationPersistence,
  async migrateHistory(input) {
    const payload = RendererStateHistoryMigrationSchema.parse(input);
    const id = browserId("cmd_renderer_state_migrate_history");
    const result = RendererStateMigrationResultSchema.parse(
      await invokeCommand(
        createEnvelope("rendererState.migrateHistory", payload, {
          id,
          correlationId: id
        })
      )
    );
    return result.ok;
  },
  async listHistoryKeys() {
    const id = browserId("cmd_renderer_state_list_history");
    return RendererStateHistoryKeysResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.listHistoryKeys",
          {},
          { id, correlationId: id }
        )
      )
    );
  }
};
