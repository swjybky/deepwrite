import {
  SystemEventEnvelopeSchema,
  createEnvelope,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { createConversationExportRuntime } from "./conversation-export/runtime";
import { fileURLToPath } from "node:url";
import { RendererStateStore } from "./renderer-state-store";
import { handleRendererStateCommand } from "./renderer-state-commands";
import { describeStorageFailure } from "./conversation-storage/storage-failure";
import type { UtilityRuntimeOptions } from "./runtime";

/** Keeps conversation routing and the storage worker's lifetime together. */
export function createCoreConversationRuntime(
  userDataPath: string,
  coreEntryUrl: string
) {
  let latestEmitEvent: ((event: SystemEventEnvelope) => void) | undefined;
  const store = new RendererStateStore(userDataPath, {
    workerPath: fileURLToPath(
      new URL("./conversation-storage/worker-entry.js", coreEntryUrl)
    ),
    onCompactionUpdated: (status) => {
      latestEmitEvent?.(
        SystemEventEnvelopeSchema.parse(
          createEnvelope(
            "rendererState.compactionUpdated",
            { status },
            { id: createId("evt_compaction") }
          )
        ) as SystemEventEnvelope
      );
    }
  });
  const exports = createConversationExportRuntime();
  return {
    async close() {
      const results = await Promise.allSettled([
        exports.close(),
        store.close()
      ]);
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
    },
    wrap(
      handler: NonNullable<UtilityRuntimeOptions["commandHandler"]>
    ): NonNullable<UtilityRuntimeOptions["commandHandler"]> {
      return async (command, emitEvent, ...context) => {
        if (emitEvent) latestEmitEvent = emitEvent;
        const exportResult = await exports.handle(command);
        if (exportResult) return exportResult;
        if (!command.type.startsWith("rendererState."))
          return handler(command, emitEvent, ...context);
        try {
          const result = await handleRendererStateCommand(store, command);
          return (
            result ?? {
              status: "rejected",
              requestId: command.id,
              error: {
                code: "core.unsupported_command",
                message: `Core Utility does not handle ${command.type}.`
              }
            }
          );
        } catch (error: unknown) {
          const {
            message,
            code: storageCode,
            ...details
          } = describeStorageFailure(error, "operation");
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "renderer_state.command_failed",
              message,
              details: { storageCode, ...details }
            }
          };
        }
      };
    }
  };
}
