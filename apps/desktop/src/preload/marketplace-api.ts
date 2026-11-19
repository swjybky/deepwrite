import { ipcRenderer } from "electron";
import * as C from "@deepwrite/contracts";
const invokeMarketplace = (request: unknown): Promise<unknown> =>
  ipcRenderer.invoke(
    C.MARKETPLACE_IPC_CHANNEL,
    C.MarketplaceIpcRequestSchema.parse(request)
  );
export const marketplace: C.DeepWriteApi["marketplace"] = {
  async sendEmailCode(input) {
    return C.MarketplaceEmailCodeResultSchema.parse(
      await invokeMarketplace({
        operation: "sendEmailCode",
        input: C.MarketplaceEmailCodeInputSchema.parse(input)
      })
    );
  },
  async bindEmail(input) {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({
        operation: "bindEmail",
        input: C.MarketplaceBindEmailInputSchema.parse(input)
      })
    );
  },
  async session() {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({ operation: "session" })
    );
  },
  async register(input: C.MarketplaceRegisterInput) {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({
        operation: "register",
        input: C.MarketplaceRegisterInputSchema.parse(input)
      })
    );
  },
  async login(input: C.MarketplaceLoginInput) {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({
        operation: "login",
        input: C.MarketplaceLoginInputSchema.parse(input)
      })
    );
  },
  async loginWithEmailCode(input: C.MarketplaceEmailLoginInput) {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({
        operation: "loginWithEmailCode",
        input: C.MarketplaceEmailLoginInputSchema.parse(input)
      })
    );
  },
  async logout() {
    return C.MarketplaceSessionSchema.parse(
      await invokeMarketplace({ operation: "logout" })
    );
  },
  async list(filter: C.MarketplaceListFilter = {}) {
    return C.MarketplaceContentPageSchema.parse(
      await invokeMarketplace({
        operation: "list",
        filter: C.MarketplaceListFilterSchema.parse(filter)
      })
    );
  },
  async detail(ref: C.MarketplaceContentRef) {
    return C.MarketplaceContentDetailSchema.parse(
      await invokeMarketplace({
        operation: "detail",
        ref: C.MarketplaceContentRefSchema.parse(ref)
      })
    );
  },
  async listMine(filter: C.MarketplaceListFilter = {}) {
    return C.MarketplaceContentPageSchema.parse(
      await invokeMarketplace({
        operation: "listMine",
        filter: C.MarketplaceListFilterSchema.parse(filter)
      })
    );
  },
  async myDetail(ref: C.MarketplaceContentRef) {
    return C.MarketplaceContentDetailSchema.parse(
      await invokeMarketplace({
        operation: "myDetail",
        ref: C.MarketplaceContentRefSchema.parse(ref)
      })
    );
  },
  async publish(input: C.MarketplacePublishInput) {
    return C.MarketplaceContentDetailSchema.parse(
      await invokeMarketplace({
        operation: "publish",
        input: C.MarketplacePublishInputSchema.parse(input)
      })
    );
  },
  async update(input: C.MarketplaceUpdateInput) {
    return C.MarketplaceContentDetailSchema.parse(
      await invokeMarketplace({
        operation: "update",
        input: C.MarketplaceUpdateInputSchema.parse(input)
      })
    );
  },
  async setEnabled(input: C.MarketplaceSetEnabledInput) {
    return C.MarketplaceContentSummarySchema.parse(
      await invokeMarketplace({
        operation: "setEnabled",
        input: C.MarketplaceSetEnabledInputSchema.parse(input)
      })
    );
  },
  async delete(ref: C.MarketplaceContentRef) {
    await invokeMarketplace({
      operation: "delete",
      ref: C.MarketplaceContentRefSchema.parse(ref)
    });
  },
  async like(input: C.MarketplaceLikeInput) {
    return C.MarketplaceLikeResultSchema.parse(
      await invokeMarketplace({
        operation: "like",
        input: C.MarketplaceLikeInputSchema.parse(input)
      })
    );
  },
  async previewInstall(ref: C.MarketplaceContentRef) {
    return C.MarketplaceInstallPreviewSchema.parse(
      await invokeMarketplace({
        operation: "previewInstall",
        ref: C.MarketplaceContentRefSchema.parse(ref)
      })
    );
  },
  async install(input: C.MarketplaceInstallInput) {
    return C.MarketplaceInstallResultSchema.parse(
      await invokeMarketplace({
        operation: "install",
        input: C.MarketplaceInstallInputSchema.parse(input)
      })
    );
  },
  async listMaterials(filter: C.MarketplaceMaterialFilter = {}) {
    return C.MarketplaceMaterialListSchema.parse(
      await invokeMarketplace({ operation: "listMaterials", filter })
    );
  },
  async materialDetail(id: string) {
    return C.MarketplaceMaterialDetailSchema.parse(
      await invokeMarketplace({ operation: "materialDetail", id })
    );
  },
  async installMaterial(ref: C.MarketplaceMaterialRef) {
    return C.MarketplaceMaterialInstallResultSchema.parse(
      await invokeMarketplace({ operation: "installMaterial", ref })
    );
  }
};
