import { createHash, randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import {
  DEVICE_SYNC_IPC_CHANNEL,
  DeviceSyncRequestEnvelopeSchema,
  DeviceSyncInventorySchema,
  DeviceSyncWorkspaceCommandEnvelopeSchema,
  createEnvelope,
  dispatchSyncRequest,
  syncErrorMessage,
  syncResponseSchema,
  type CommandEnvelope,
  type CommandResult,
  type DeviceSyncWorkspaceRequest
} from "@deepwrite/contracts";
import { DeviceSyncService } from "./engine/service";
import {
  DesktopSyncCredentialStore,
  DesktopSyncMetadataStore
} from "./local-storage";
import { WebDavSyncTransport } from "./webdav";
import { electronDavFetch } from "./webdav-fetch";

export function createDesktopDeviceSync(
  root: string,
  options: {
    command(command: CommandEnvelope): Promise<CommandResult>;
    workspaceDirectory(): Promise<string | null>;
    busy(): boolean;
  }
) {
  const request = async (
    payload: DeviceSyncWorkspaceRequest
  ): Promise<unknown> => {
    const id = `sync_${randomUUID()}`;
    const command = DeviceSyncWorkspaceCommandEnvelopeSchema.parse(
      createEnvelope("deviceSync.workspace", payload, { id, correlationId: id })
    );
    const result = await options.command(command);
    if (result.status !== "accepted") throw new Error(result.error.message);
    return result.payload;
  };
  return new DeviceSyncService({
    runtime: {
      id: randomUUID,
      now: () => new Date().toISOString(),
      hash: (value) => createHash("sha256").update(value, "utf8").digest("hex")
    },
    metadata: new DesktopSyncMetadataStore(root),
    credentials: new DesktopSyncCredentialStore(root),
    transport: (config, password) =>
      new WebDavSyncTransport(config, password, electronDavFetch),
    workspace: {
      list: async () =>
        DeviceSyncInventorySchema.parse(await request({ operation: "list" })),
      validate: async (item) => {
        await request({ operation: "validate", item });
      },
      recover: async () => {
        await request({ operation: "recover" });
      },
      apply: async (key, expected, next) => {
        if (options.busy())
          throw new Error("作品正在生成或保存，请完成后再同步。");
        const workspaceDirectory = await options.workspaceDirectory();
        if (!workspaceDirectory) throw new Error("请先选择本机工作目录。");
        await request({
          operation: "apply",
          key,
          expected,
          next,
          workspaceDirectory
        });
      }
    }
  });
}
export function registerDeviceSyncIpc(
  service: () => DeviceSyncService | undefined,
  window: () => BrowserWindow | null | undefined,
  busy: () => boolean
): void {
  ipcMain.handle(DEVICE_SYNC_IPC_CHANNEL, async (event, raw: unknown) => {
    try {
      const main = window();
      if (!main || main.isDestroyed() || event.sender !== main.webContents)
        throw new Error("无效的同步请求来源。");
      const input = DeviceSyncRequestEnvelopeSchema.parse(raw);
      const api = service();
      if (!api) throw new Error("同步尚未初始化。");
      if (["sync", "restore"].includes(input.payload.operation) && busy())
        throw new Error("作品正在生成或保存，请完成后再同步。");
      return {
        ok: true,
        value: syncResponseSchema.parse(
          await dispatchSyncRequest(api, input.payload)
        )
      };
    } catch (error) {
      return { ok: false, message: syncErrorMessage(error) };
    }
  });
}
