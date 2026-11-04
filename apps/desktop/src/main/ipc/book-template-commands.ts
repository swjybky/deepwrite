import { app } from "electron";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { BookTemplateStore } from "../book-template-store";
import {
  handleCatalogProjectCommands,
  type CatalogProjectCommandContext
} from "./catalog-project-commands";
let store: BookTemplateStore | undefined;
function getStore() {
  return (store ??= new BookTemplateStore(app.getPath("userData")));
}
export async function handleBookTemplateCommands(
  ctx: CatalogProjectCommandContext,
  command: CommandEnvelope,
  templates = getStore
): Promise<CommandResult | undefined> {
  if (
    command.type !== "bookTemplates.list" &&
    command.type !== "bookTemplates.save" &&
    command.type !== "bookTemplates.delete" &&
    command.type !== "catalog.createBookFromTemplate"
  )
    return;
  try {
    const storage = templates();
    if (command.type === "catalog.createBookFromTemplate") {
      const template = (await storage.list()).find(
        (item) => item.id === command.payload.templateId
      );
      if (!template) throw new Error("模板已删除，请重新选择模板。");
      const {
        workspaceType,
        name: _name,
        linkedAgentTeamIds: _linkedAgentTeamIds,
        ...configuration
      } = template.configuration;
      return await handleCatalogProjectCommands(
        ctx,
        CommandEnvelopeSchema.parse(
          createEnvelope(
            workspaceType === "short"
              ? "catalog.createShortBook"
              : "catalog.createScriptBook",
            { ...configuration, title: command.payload.title },
            { id: command.id, context: command.context }
          )
        )
      );
    }
    const payload =
      command.type === "bookTemplates.list"
        ? await storage.list()
        : command.type === "bookTemplates.save"
          ? await storage.save(command.payload)
          : (await storage.delete(command.payload.id), { deleted: true });
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "bookTemplates.failed",
        message: error instanceof Error ? error.message : "模板操作失败。"
      }
    };
  }
}
