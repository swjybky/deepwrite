import { ipcMain, type BrowserWindow } from "electron";
import {
  MARKETPLACE_IPC_CHANNEL,
  MarketplaceIpcRequestSchema
} from "@deepwrite/contracts";
import type { MarketplaceClient } from "../marketplace-client";

export function registerMarketplaceIpc(options: {
  getMainWindow: () => BrowserWindow | undefined;
  getMarketplaceClient: () => MarketplaceClient | undefined;
}): void {
  ipcMain.handle(
    MARKETPLACE_IPC_CHANNEL,
    async (event, rawRequest: unknown): Promise<unknown> => {
      const mainWindow = options.getMainWindow();
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
      ) {
        throw new Error("技能广场 IPC 请求来源无效。");
      }
      const marketplaceClient = options.getMarketplaceClient();
      if (!marketplaceClient) {
        throw new Error("技能广场服务尚未初始化。");
      }
      const request = MarketplaceIpcRequestSchema.parse(rawRequest);
      switch (request.operation) {
        case "sendEmailCode":
          return marketplaceClient.sendEmailCode(request.input);
        case "bindEmail":
          return marketplaceClient.bindEmail(request.input);
        case "session":
          return marketplaceClient.session();
        case "register":
          return marketplaceClient.register(request.input);
        case "login":
          return marketplaceClient.login(request.input);
        case "loginWithEmailCode":
          return marketplaceClient.loginWithEmailCode(request.input);
        case "logout":
          return marketplaceClient.logout();
        case "list":
          return marketplaceClient.list(request.filter);
        case "detail":
          return marketplaceClient.detail(request.ref);
        case "listMine":
          return marketplaceClient.listMine(request.filter);
        case "myDetail":
          return marketplaceClient.myDetail(request.ref);
        case "publish":
          return marketplaceClient.publish(request.input);
        case "update":
          return marketplaceClient.update(request.input);
        case "setEnabled":
          return marketplaceClient.setEnabled(request.input);
        case "delete":
          return marketplaceClient.delete(request.ref);
        case "like":
          return marketplaceClient.like(request.input);
        case "previewInstall":
          return marketplaceClient.previewInstall(request.ref);
        case "install":
          return marketplaceClient.install(request.input);
        case "listMaterials":
          return marketplaceClient.listMaterials(request.filter);
        case "materialDetail":
          return marketplaceClient.materialDetail(request.id);
        case "installMaterial":
          return marketplaceClient.installMaterial(request.ref);
      }
    }
  );
}
