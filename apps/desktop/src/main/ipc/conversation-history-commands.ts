import { acquireConversationOperation } from "./conversation-operation-guard";
import {
  ConversationHistoryResultSchemas,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import { rejectedResult } from "./errors";

export async function handleConversationHistoryCommands(
  ctx: Pick<IpcCommandContext, "supervisor" | "activeRuns">,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!Object.hasOwn(ConversationHistoryResultSchemas, command.type)) return;
  const schema =
    ConversationHistoryResultSchemas[
      command.type as keyof typeof ConversationHistoryResultSchemas
    ];
  const managing =
    command.type === "rendererState.history.purge" ||
    (command.type === "rendererState.history.commit" &&
      command.payload.operations.some(
        (operation) => operation.type === "setDeleted"
      ));
  const release = managing
    ? acquireConversationOperation(
        ctx.activeRuns,
        command.payload.sessionId,
        "management"
      )
    : () => {};
  if (!release)
    return rejectedResult(
      command.id,
      "conversation_history.running",
      "此对话仍在运行，请先停止任务后再管理历史。"
    );
  try {
    const result = await ctx.supervisor.requestCommand("core", command, 60_000);
    if (result.status === "rejected") return result;
    return {
      status: "accepted",
      requestId: command.id,
      payload: schema.parse(result.payload)
    };
  } catch (error: unknown) {
    const timedOut = error instanceof UtilityCommandTimeoutError;
    return rejectedResult(
      command.id,
      timedOut
        ? "conversation_history.command_timeout"
        : "conversation_history.forward_failed",
      timedOut
        ? "会话历史操作超时，尚未确认保存。"
        : error instanceof Error
          ? error.message
          : "会话历史操作失败。",
      safeErrorDetails(error)
    );
  } finally {
    release();
  }
}
