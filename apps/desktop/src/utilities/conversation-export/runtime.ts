import {
  ConversationExportResultSchemas,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { ConversationExportFileStore } from "./file-store";

export function createConversationExportRuntime() {
  const store = new ConversationExportFileStore();
  return {
    close: () => store.close(),
    async handle(command: CommandEnvelope): Promise<CommandResult | undefined> {
      if (!command.type.startsWith("conversationExport.")) return;
      try {
        let payload: unknown;
        switch (command.type) {
          case "conversationExport.prepare":
            payload = await store.prepare(
              command.payload.token,
              command.payload.filePath
            );
            break;
          case "conversationExport.append":
            payload = await store.append(
              command.payload.token,
              command.payload.seq,
              command.payload.text
            );
            break;
          case "conversationExport.finish":
            payload = await store.finish(
              command.payload.token,
              command.payload.seq
            );
            break;
          case "conversationExport.cancel":
            await store.cancel(command.payload.token);
            payload = { canceled: true };
            break;
          default:
            throw new Error("Core 不处理保存位置选择。");
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload:
            ConversationExportResultSchemas[
              command.type as keyof typeof ConversationExportResultSchemas
            ].parse(payload)
        };
      } catch (error) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "conversation_export.write_failed",
            message:
              error instanceof Error
                ? error.message
                : "导出文件写入失败，请选择其他位置重试。"
          }
        };
      }
    }
  };
}
