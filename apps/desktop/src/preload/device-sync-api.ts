import { ipcRenderer } from "electron";
import {
  createEnvelope,
  DEVICE_SYNC_IPC_CHANNEL,
  DeviceSyncRequestEnvelopeSchema,
  syncRequestSchema,
  DeviceSyncIpcResultSchema,
  syncErrorMessage,
  type SyncRequest,
  type SyncResponse
} from "@deepwrite/contracts";
import { browserId } from "./invoke";

export const deviceSync = {
  async request(request: SyncRequest): Promise<SyncResponse> {
    try {
      const requestValue = syncRequestSchema.safeParse(request);
      if (!requestValue.success)
        throw new Error("请填写有效的 HTTPS 地址、账号和同步目录。");
      const id = browserId("cmd_device_sync");
      const envelope = DeviceSyncRequestEnvelopeSchema.parse(
        createEnvelope("deviceSync.request", requestValue.data, {
          id,
          correlationId: id
        })
      );
      const result = DeviceSyncIpcResultSchema.parse(
        await ipcRenderer.invoke(DEVICE_SYNC_IPC_CHANNEL, envelope)
      );
      if (!result.ok) throw new Error(result.message);
      return result.value;
    } catch (error) {
      throw new Error(syncErrorMessage(error));
    }
  }
};
