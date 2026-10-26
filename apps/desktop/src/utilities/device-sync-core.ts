import { inspectDesktopInitialization } from "./device-sync-initialization-inspection";
import {
  recoverDesktopInitialization,
  replaceDesktopInitialization
} from "./device-sync-initialization";
import {
  DeviceSyncInventorySchema,
  syncErrorMessage,
  SyncItemValidationError,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import { DeviceSyncRecoveryPausedError } from "./device-sync-recovery";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";

/** All Core commands join the same barrier; only Core can mutate project files. */
export function withDeviceSyncCommands(
  userDataPath: string,
  catalog: () => Promise<FolderCatalogStore>,
  long: LongWorkspaceService,
  handler: (
    command: CommandEnvelope,
    emitEvent?: (event: SystemEventEnvelope) => void
  ) => Promise<CommandResult>
) {
  const workspace = new DesktopSyncWorkspace(userDataPath, catalog, long);
  let tail: Promise<unknown> = Promise.resolve();
  return (
    command: CommandEnvelope,
    emitEvent?: (event: SystemEventEnvelope) => void
  ): Promise<CommandResult> => {
    const result = tail.then(async (): Promise<CommandResult> => {
      try {
        await recoverDesktopInitialization(userDataPath);
        try {
          await workspace.recover();
        } catch (error) {
          // The plan is durably isolated now. Unrelated Core commands may proceed;
          // a damaged target still has its own project transaction/version guards.
          if (
            command.type === "deviceSync.workspace" ||
            !(error instanceof DeviceSyncRecoveryPausedError)
          )
            throw error;
        }
        if (command.type !== "deviceSync.workspace")
          return handler(command, emitEvent);
        const input = command.payload;
        let payload: unknown = {};
        switch (input.operation) {
          case "inspect-initialization":
            payload = await inspectDesktopInitialization(userDataPath);
            break;
          case "replace-initialization":
            await replaceDesktopInitialization(userDataPath, input);
            break;
          case "list":
            payload = DeviceSyncInventorySchema.parse(await workspace.list());
            break;
          case "validate":
            await workspace.validate(input.item);
            break;
          case "recover":
            await workspace.recover();
            break;
          case "apply":
            await workspace.apply(
              input.key,
              input.expected,
              input.next,
              input.workspaceDirectory
            );
            break;
        }
        return { status: "accepted", requestId: command.id, payload };
      } catch (error) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code:
              error instanceof SyncItemValidationError
                ? "device_sync.validation_failed"
                : "device_sync.workspace_failed",
            message: syncErrorMessage(error),
            ...(error instanceof SyncItemValidationError
              ? { details: { paths: error.paths } }
              : {})
          }
        };
      }
    });
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
