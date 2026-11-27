import { nativeMessages, nativeText } from "./native-i18n";
import { app, dialog, shell, type BrowserWindow } from "electron";
import {
  ConversationCompactionStatusSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { StorageSettingsService } from "./storage-settings-service";
import type { StorageLocationStore } from "./storage-location-store";
import type { WorkspaceDirectoryStore } from "./workspace-directory-store";
import { installationDirectory } from "./installation-directory-guard";

export function createStorageSettingsService(options: {
  locations: StorageLocationStore;
  workspace(): WorkspaceDirectoryStore;
  getWindow(): BrowserWindow;
  busy(): boolean;
  flushRenderer(): Promise<void>;
  restart(): void;
  command?: (command: CommandEnvelope) => Promise<CommandResult>;
}): StorageSettingsService {
  async function requestCompaction(
    type:
      | "rendererState.compactionStatus"
      | "rendererState.compactConversations"
      | "rendererState.releaseCompactionBackup",
    payload: Record<string, unknown> = {}
  ) {
    if (!options.command) {
      throw new Error("Core conversation compaction bridge is unavailable.");
    }
    const id = createId("cmd_compaction");
    const envelope = createEnvelope(type, payload as never, {
      id,
      correlationId: id
    });
    const result = await options.command(envelope);
    if (result.status !== "accepted") {
      throw new Error(result.error.message);
    }
    return ConversationCompactionStatusSchema.parse(result.payload);
  }

  return new StorageSettingsService({
    ...options,
    documentsPath: () => app.getPath("documents"),
    installationDirectory: () => installationDirectory(process.execPath),
    ...(options.command
      ? {
          compaction: {
            status: () => requestCompaction("rendererState.compactionStatus"),
            compact: (compactOptions) =>
              requestCompaction(
                "rendererState.compactConversations",
                compactOptions ?? {}
              ),
            releaseBackup: () =>
              requestCompaction("rendererState.releaseCompactionBackup")
          }
        }
      : {}),
    async chooseDirectory(currentPath) {
      const result = await dialog.showOpenDialog(options.getWindow(), {
        title: nativeText("chooseUserData"),
        defaultPath: currentPath,
        properties: ["openDirectory", "createDirectory"]
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    async confirmMigration(source, target, restoreDefault, createsSubfolder) {
      const result = await dialog.showMessageBox(options.getWindow(), {
        type: "question",
        title: nativeText("migrateUserData"),
        message: nativeText("confirmMigration"),
        detail: nativeMessages().migrationDetails(
          source,
          target,
          restoreDefault,
          createsSubfolder
        ),
        buttons: [nativeText("cancel"), nativeText("migrateAndRestart")],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return result.response === 1;
    },
    openPath: (path) => shell.openPath(path)
  });
}
