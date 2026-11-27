import {
  ConversationCompactionStatusSchema,
  StorageChangeResultSchema,
  StorageOpenDirectoryInputSchema,
  StorageOpenDirectoryResultSchema,
  StorageSettingsSnapshotSchema,
  WorkspaceDirectorySettingsSchema,
  createEnvelope,
  type StorageSettingsApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const storageSettings: StorageSettingsApi = {
  async get() {
    const id = browserId("cmd_storage_settings_get");
    return StorageSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("storageSettings.get", {}, { id, correlationId: id })
      )
    );
  },
  async chooseUserData() {
    const id = browserId("cmd_storage_settings_choose_user_data");
    return StorageChangeResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "storageSettings.chooseUserData",
          {},
          { id, correlationId: id }
        )
      )
    );
  },
  async resetUserData() {
    const id = browserId("cmd_storage_settings_reset_user_data");
    return StorageChangeResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "storageSettings.resetUserData",
          {},
          { id, correlationId: id }
        )
      )
    );
  },
  async resetWorkspaceDirectory() {
    const id = browserId("cmd_storage_settings_reset_workspace_directory");
    return WorkspaceDirectorySettingsSchema.parse(
      await invokeCommand(
        createEnvelope(
          "storageSettings.resetWorkspaceDirectory",
          {},
          { id, correlationId: id }
        )
      )
    );
  },
  async openDirectory(kind) {
    const input = StorageOpenDirectoryInputSchema.parse({ kind });
    const id = browserId("cmd_storage_settings_open_directory");
    StorageOpenDirectoryResultSchema.parse(
      await invokeCommand(
        createEnvelope("storageSettings.openDirectory", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async compactConversations() {
    const id = browserId("cmd_storage_settings_compact");
    return ConversationCompactionStatusSchema.parse(
      await invokeCommand(
        createEnvelope(
          "storageSettings.compactConversations",
          {},
          { id, correlationId: id }
        )
      )
    );
  },
  async releaseConversationBackup() {
    const id = browserId("cmd_storage_settings_release_backup");
    return ConversationCompactionStatusSchema.parse(
      await invokeCommand(
        createEnvelope(
          "storageSettings.releaseConversationBackup",
          {},
          { id, correlationId: id }
        )
      )
    );
  }
};
