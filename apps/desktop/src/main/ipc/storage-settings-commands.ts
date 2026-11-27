import {
  ConversationCompactionStatusSchema,
  StorageChangeResultSchema,
  StorageSettingsSnapshotSchema,
  WorkspaceDirectorySettingsSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  StorageSettingsError,
  type StorageSettingsService
} from "../storage-settings-service";
import { rejectedResult } from "./errors";

export async function handleStorageSettingsCommands(
  command: CommandEnvelope,
  service: StorageSettingsService
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("storageSettings.")) return undefined;
  try {
    let payload: unknown;
    switch (command.type) {
      case "storageSettings.get":
        payload = StorageSettingsSnapshotSchema.parse(await service.get());
        break;
      case "storageSettings.chooseUserData":
        payload = StorageChangeResultSchema.parse(
          await service.chooseUserData()
        );
        break;
      case "storageSettings.resetUserData":
        payload = StorageChangeResultSchema.parse(
          await service.resetUserData()
        );
        break;
      case "storageSettings.resetWorkspaceDirectory":
        payload = WorkspaceDirectorySettingsSchema.parse(
          await service.resetWorkspaceDirectory()
        );
        break;
      case "storageSettings.openDirectory":
        payload = await service.openDirectory(command.payload.kind);
        break;
      case "storageSettings.compactConversations":
        payload = ConversationCompactionStatusSchema.parse(
          await service.compactConversations()
        );
        break;
      case "storageSettings.releaseConversationBackup":
        payload = ConversationCompactionStatusSchema.parse(
          await service.releaseConversationBackup()
        );
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      error instanceof StorageSettingsError
        ? error.code
        : "storage_settings.operation_failed",
      error instanceof Error ? error.message : "存储设置操作失败，请重试。"
    );
  }
}
