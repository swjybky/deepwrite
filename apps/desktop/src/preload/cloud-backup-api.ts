import { ipcRenderer } from "electron";
import {
  CLOUD_BACKUP_IPC_CHANNEL,
  CloudBackupApplyResultSchema,
  CloudBackupIpcRequestSchema,
  CloudBackupPreviewSchema,
  CloudBackupStatusSchema
} from "@deepwrite/contracts";

async function invokeCloudBackup(rawRequest: unknown): Promise<unknown> {
  const request = CloudBackupIpcRequestSchema.parse(rawRequest);
  return ipcRenderer.invoke(
    CLOUD_BACKUP_IPC_CHANNEL,
    request
  ) as Promise<unknown>;
}

export const cloudBackup = {
  async status() {
    return CloudBackupStatusSchema.parse(
      await invokeCloudBackup({ operation: "status" })
    );
  },
  async previewBackup() {
    return CloudBackupPreviewSchema.parse(
      await invokeCloudBackup({ operation: "previewBackup" })
    );
  },
  async applyBackup(previewId: string) {
    return CloudBackupApplyResultSchema.parse(
      await invokeCloudBackup({
        operation: "applyBackup",
        previewId
      })
    );
  },
  async previewRestore(machineKey: string) {
    return CloudBackupPreviewSchema.parse(
      await invokeCloudBackup({
        operation: "previewRestore",
        machineKey
      })
    );
  },
  async applyRestore(previewId: string) {
    return CloudBackupApplyResultSchema.parse(
      await invokeCloudBackup({
        operation: "applyRestore",
        previewId
      })
    );
  }
};
