import { ipcRenderer } from "electron";
import {
  APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
  APP_ALERT_GET_CHANNEL,
  AppAlertDesktopRevisionSchema,
  AppAlertSnapshotSchema,
  CLOUD_BACKUP_IPC_CHANNEL,
  CloudBackupApplyResultSchema,
  CloudBackupIpcRequestSchema,
  CloudBackupPreviewSchema,
  CloudBackupStatusSchema,
  RendererStateKeySchema,
  RendererStateLoadResultSchema,
  RendererStateMutationResultSchema,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UpdateStateSchema,
  createEnvelope,
  type AppAlertSnapshot,
  type DeepWriteApi,
  type UpdateState
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export async function loadConversationPersistence(
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

export async function saveConversationPersistence(
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

export async function removeConversationPersistence(
  rawKey: string
): Promise<void> {
  const key = RendererStateKeySchema.parse(rawKey);
  const id = browserId("cmd_renderer_state_remove");
  RendererStateMutationResultSchema.parse(
    await invokeCommand(
      createEnvelope("rendererState.remove", { key }, { id, correlationId: id })
    )
  );
}

export async function getUpdateState(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL)
  );
}

export async function checkForUpdates(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_CHECK_CHANNEL)
  );
}

export async function downloadUpdate(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL)
  );
}

export async function installUpdate(): Promise<void> {
  await ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL);
}

export async function getAppAlerts(): Promise<AppAlertSnapshot> {
  return AppAlertSnapshotSchema.parse(
    await ipcRenderer.invoke(APP_ALERT_GET_CHANNEL)
  );
}

export async function acknowledgeDesktopAlert(
  rawRevision: string
): Promise<void> {
  const revision = AppAlertDesktopRevisionSchema.parse(rawRevision);
  await ipcRenderer.invoke(APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL, revision);
}

export async function invokeCloudBackup(rawRequest: unknown): Promise<unknown> {
  const request = CloudBackupIpcRequestSchema.parse(rawRequest);
  return ipcRenderer.invoke(
    CLOUD_BACKUP_IPC_CHANNEL,
    request
  ) as Promise<unknown>;
}

export const updates: DeepWriteApi["updates"] = {
  getState: getUpdateState,
  check: checkForUpdates,
  download: downloadUpdate,
  install: installUpdate,
  subscribe(listener: (state: UpdateState) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      rawState: unknown
    ): void => {
      const parsed = UpdateStateSchema.safeParse(rawState);
      if (!parsed.success) {
        console.warn("DeepWrite discarded an invalid update state event.");
        return;
      }
      listener(parsed.data);
    };
    ipcRenderer.on(UPDATE_STATE_EVENT_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(UPDATE_STATE_EVENT_CHANNEL, handler);
  }
};

export const appAlerts: DeepWriteApi["appAlerts"] = {
  get: getAppAlerts,
  acknowledgeDesktop: acknowledgeDesktopAlert
};

export { marketplace } from "./marketplace-api";

export const cloudBackup: DeepWriteApi["cloudBackup"] = {
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
