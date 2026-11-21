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
  const store = new RendererStateStore(userDataPath, {
    workerPath: fileURLToPath(
      new URL("./conversation-storage/worker-entry.js", coreEntryUrl)
    )
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
      return async (command, ...context) => {
        const exportResult = await exports.handle(command);
        if (exportResult) return exportResult;
        if (!command.type.startsWith("rendererState."))
          return handler(command, ...context);
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
