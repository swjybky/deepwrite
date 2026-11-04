import { ipcMain, type BrowserWindow } from "electron";
import {
  FEEDBACK_IPC_CHANNEL,
  FeedbackIpcRequestSchema,
  type FeedbackImage
} from "@deepwrite/contracts";
import type { FeedbackClient } from "./client";

async function captureWindow(window: BrowserWindow): Promise<FeedbackImage> {
  const image = await window.webContents.capturePage();
  if (image.isEmpty()) throw new Error("没有截取到窗口内容，请重试。");
  return { contentType: "image/png", data: image.toPNG().toString("base64") };
}

export function registerFeedbackIpc(
  getClient: () => FeedbackClient | undefined,
  getMainWindow: () => BrowserWindow | null | undefined
): void {
  ipcMain.handle(
    FEEDBACK_IPC_CHANNEL,
    async (event, rawRequest: unknown): Promise<unknown> => {
      const mainWindow = getMainWindow();
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
      ) {
        throw new Error("反馈 IPC 请求来源无效。");
      }
      const request = FeedbackIpcRequestSchema.parse(rawRequest);
      if (request.operation === "captureWindow") {
        return captureWindow(mainWindow);
      }
      const client = getClient();
      if (!client) throw new Error("反馈服务尚未初始化。");
      switch (request.operation) {
        case "list":
          return client.list(request.filter);
        case "submit":
          return client.submit(request.input);
        case "image":
          return client.image(request.target);
      }
    }
  );
}
