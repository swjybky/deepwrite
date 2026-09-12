import {
  LongApplyOperationsResultSchema,
  LongResolveConflictsResultSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadAgentsMdResultSchema,
  LongReadDocumentResultSchema,
  LongRemoveBookResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteAgentsMdResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleLongWorkspaceCommands(
  ctx: Pick<IpcCommandContext, "supervisor">,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "long.resolveConflicts" ||
    command.type === "long.list" ||
    command.type === "long.open" ||
    command.type === "long.duplicateBook" ||
    command.type === "long.rename" ||
    command.type === "long.updateBindings" ||
    command.type === "long.getWorkspaceIndex" ||
    command.type === "long.readDocument" ||
    command.type === "long.readAgentsMd" ||
    command.type === "long.search" ||
    command.type === "long.writeDocument" ||
    command.type === "long.writeAgentsMd" ||
    command.type === "long.previewOperations" ||
    command.type === "long.applyOperations" ||
    command.type === "long.writeChapter" ||
    command.type === "long.commitChapter" ||
    command.type === "long.deleteLedgerCommit" ||
    command.type === "long.unregister" ||
    command.type === "long.delete"
  ) {
    try {
      const result = await ctx.supervisor.requestCommand(
        "core",
        command,
        60_000
      );
      if (result.status === "rejected") return result;
      let payload: unknown;
      switch (command.type) {
        case "long.resolveConflicts":
          payload = LongResolveConflictsResultSchema.parse(result.payload);
          break;
        case "long.list":
          payload = LongListBooksResultSchema.parse(result.payload);
          break;
        case "long.open":
        case "long.duplicateBook":
        case "long.rename":
        case "long.updateBindings":
          payload = LongOpenBookResultSchema.parse(result.payload);
          break;
        case "long.getWorkspaceIndex":
          payload = LongWorkspaceIndexResultSchema.parse(result.payload);
          break;
        case "long.readDocument":
          payload = LongReadDocumentResultSchema.parse(result.payload);
          break;
        case "long.readAgentsMd":
          payload = LongReadAgentsMdResultSchema.parse(result.payload);
          break;
        case "long.search":
          payload = LongSearchResultSchema.parse(result.payload);
          break;
        case "long.writeDocument":
          payload = LongWriteDocumentResultSchema.parse(result.payload);
          break;
        case "long.writeAgentsMd":
          payload = LongWriteAgentsMdResultSchema.parse(result.payload);
          break;
        case "long.previewOperations":
          payload = LongPreviewOperationsResultSchema.parse(result.payload);
          break;
        case "long.applyOperations":
          payload = LongApplyOperationsResultSchema.parse(result.payload);
          break;
        case "long.writeChapter":
          payload = LongWriteChapterResultSchema.parse(result.payload);
          break;
        case "long.commitChapter":
          payload = LongCommitChapterResultSchema.parse(result.payload);
          break;
        case "long.deleteLedgerCommit":
          payload = LongDeleteLedgerCommitResultSchema.parse(result.payload);
          break;
        case "long.unregister":
        case "long.delete":
          payload = LongRemoveBookResultSchema.parse(result.payload);
          break;
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof UtilityCommandTimeoutError
              ? "long.command_timeout"
              : "long.forward_failed",
          message:
            error instanceof UtilityCommandTimeoutError
              ? "长篇操作等待超时，结果尚未确认；请刷新作品核对后再决定是否重试。"
              : error instanceof Error
                ? error.message
                : "长篇操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
