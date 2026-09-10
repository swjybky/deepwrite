import {
  DeviceSyncInventorySchema,
  syncErrorMessage,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";

/** All Core commands join the same barrier; only Core can mutate project files. */
export function withDeviceSyncCommands(
  userDataPath: string,
  catalog: () => Promise<FolderCatalogStore>,
  long: LongWorkspaceService,
  handler: (command: CommandEnvelope) => Promise<CommandResult>
) {
  const workspace = new DesktopSyncWorkspace(userDataPath, catalog, long);
  let tail: Promise<unknown> = Promise.resolve();
  return (command: CommandEnvelope): Promise<CommandResult> => {
    const result = tail.then(async (): Promise<CommandResult> => {
      try {
        await workspace.recover();
        if (command.type !== "deviceSync.workspace") return handler(command);
        const input = command.payload;
        let payload: unknown = {};
        switch (input.operation) {
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
            code: "device_sync.workspace_failed",
            message: syncErrorMessage(error)
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
