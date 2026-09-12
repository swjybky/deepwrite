import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  ConversationExportResultSchemas,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ConversationExportBeginResult
} from "@deepwrite/contracts";
import type { IpcCommandContext } from "./command-types";

type ExportContext = Pick<
  IpcCommandContext,
  "dialog" | "getMainWindow" | "senderWebContentsId" | "supervisor"
>;
interface Authorization {
  senderId: number;
  token: string;
  touchedAt: number;
}
type SelectedFile =
  { canceled: true } | { canceled: false; token: string; filePath: string };
interface BeginRequest {
  name: string;
  touchedAt: number;
  invalidated: boolean;
  selection: Promise<SelectedFile>;
  preparing?: Promise<ConversationExportBeginResult>;
}
const tokens = new Map<string, Authorization>();
const begins = new Map<string, BeginRequest>();
const RETAIN_MS = 15 * 60_000;

async function requestCore(
  ctx: ExportContext,
  command: CommandEnvelope
): Promise<unknown> {
  const response = await ctx.supervisor.requestCommand("core", command, 60_000);
  if (response.status === "rejected") throw new Error(response.error.message);
  return response.payload;
}
function safeName(input: string): string {
  const name = basename(input).replace(/[<>:"|?*\x00-\x1F]/g, "_");
  let result = "";
  for (const character of name) {
    if (Buffer.byteLength(result + character, "utf8") > 120) break;
    result += character;
  }
  return `${result.replace(/\.json$/i, "") || "conversation"}.json`;
}
async function begin(
  ctx: ExportContext,
  command: Extract<CommandEnvelope, { type: "conversationExport.begin" }>
): Promise<ConversationExportBeginResult> {
  const key = `${ctx.senderWebContentsId}:${command.payload.nonce}`;
  let request = begins.get(key);
  if (request && request.name !== command.payload.suggestedName)
    throw new Error("导出请求标识已用于其他文件。");
  if (!request) {
    const created: BeginRequest = {
      name: command.payload.suggestedName,
      touchedAt: Date.now(),
      invalidated: false,
      selection: Promise.resolve({ canceled: true })
    };
    created.selection = (async (): Promise<SelectedFile> => {
      const selection = await ctx.dialog.showSaveDialog(ctx.getMainWindow(), {
        title: "导出当前对话（含未保存内容）",
        defaultPath: safeName(command.payload.suggestedName),
        filters: [{ name: "JSON 对话文件", extensions: ["json"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"]
      });
      if (created.invalidated || selection.canceled || !selection.filePath)
        return { canceled: true };
      const token = randomUUID();
      tokens.set(token, {
        senderId: ctx.senderWebContentsId,
        token,
        touchedAt: Date.now()
      });
      return { canceled: false, token, filePath: selection.filePath };
    })();
    begins.set(key, created);
    request = created;
  }
  request.touchedAt = Date.now();
  const selection = await request.selection;
  if (selection.canceled || request.invalidated) return { canceled: true };
  const selectedRequest = request;
  if (!selectedRequest.preparing) {
    selectedRequest.preparing = (async () => {
      ConversationExportResultSchemas["conversationExport.prepare"].parse(
        await requestCore(
          ctx,
          createEnvelope(
            "conversationExport.prepare",
            { token: selection.token, filePath: selection.filePath },
            { id: randomUUID() }
          )
        )
      );
      return { canceled: false as const, token: selection.token };
    })();
  }
  const preparing = selectedRequest.preparing;
  try {
    return await preparing;
  } finally {
    if (selectedRequest.preparing === preparing)
      delete selectedRequest.preparing;
  }
}

export async function handleConversationExportCommands(
  ctx: ExportContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("conversationExport.")) return;
  if (command.type === "conversationExport.prepare")
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "conversation_export.forbidden",
        message: "Renderer 不能直接指定导出路径。"
      }
    };
  try {
    for (const [key, request] of begins)
      if (Date.now() - request.touchedAt > RETAIN_MS) {
        request.invalidated = true;
        begins.delete(key);
      }
    for (const [token, entry] of tokens)
      if (Date.now() - entry.touchedAt > RETAIN_MS) tokens.delete(token);
    let payload: unknown;
    if (command.type === "conversationExport.begin")
      payload = await begin(ctx, command);
    else if (
      command.type === "conversationExport.append" ||
      command.type === "conversationExport.finish" ||
      command.type === "conversationExport.cancel"
    ) {
      const entry = tokens.get(command.payload.token);
      if (!entry || entry.senderId !== ctx.senderWebContentsId)
        throw new Error("导出授权无效或已过期，请重新选择保存位置。");
      entry.touchedAt = Date.now();
      payload = await requestCore(ctx, command);
    } else throw new Error("不支持的导出操作。");
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
        code: "conversation_export.failed",
        message:
          error instanceof Error
            ? error.message
            : "导出未完成，请重新选择保存位置。"
      }
    };
  }
}

/** Call when the owning renderer is destroyed; Core also cancels on shutdown/expiry. */
export async function disposeConversationExports(
  ctx: ExportContext
): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [token, entry] of tokens) {
    if (entry.senderId !== ctx.senderWebContentsId) continue;
    tokens.delete(token);
    jobs.push(
      requestCore(
        ctx,
        createEnvelope(
          "conversationExport.cancel",
          { token },
          { id: randomUUID() }
        )
      )
    );
  }
  for (const [key, request] of begins)
    if (key.startsWith(`${ctx.senderWebContentsId}:`)) {
      request.invalidated = true;
      begins.delete(key);
    }
  await Promise.allSettled(jobs);
}
