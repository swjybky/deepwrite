import { handleConversationHistoryCommand } from "./conversation-history-commands";
import {
  ConversationCompactionStatusSchema,
  RendererStateLoadResultSchema,
  RendererStateMutationResultSchema,
  RendererStateHistoryKeysResultSchema,
  RendererStateMigrationResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { RendererStateStore } from "./renderer-state-store";

export async function handleRendererStateCommand(
  rendererStateStore: RendererStateStore,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  const historyResult = await handleConversationHistoryCommand(
    rendererStateStore.history,
    command
  );
  if (historyResult) return historyResult;
  if (command.type === "rendererState.migrateHistory") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: RendererStateMigrationResultSchema.parse({
        ok: await rendererStateStore.migrateHistory(command.payload)
      })
    };
  }
  if (command.type === "rendererState.listHistoryKeys") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: RendererStateHistoryKeysResultSchema.parse(
        await rendererStateStore.listHistoryKeys()
      )
    };
  }
  if (command.type === "rendererState.load") {
    const value = await rendererStateStore.load(command.payload.key);
    return {
      status: "accepted",
      requestId: command.id,
      payload: RendererStateLoadResultSchema.parse(
        value === undefined ? { found: false } : { found: true, value }
      )
    };
  }
  if (command.type === "rendererState.save") {
    await rendererStateStore.save(command.payload.key, command.payload.value);
    return {
      status: "accepted",
      requestId: command.id,
      payload: RendererStateMutationResultSchema.parse({ ok: true })
    };
  }
  if (command.type === "rendererState.remove") {
    await rendererStateStore.remove(command.payload.key);
    return {
      status: "accepted",
      requestId: command.id,
      payload: RendererStateMutationResultSchema.parse({ ok: true })
    };
  }
  if (command.type === "rendererState.compactionStatus") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: ConversationCompactionStatusSchema.parse(
        await rendererStateStore.compactionStatus()
      )
    };
  }
  if (command.type === "rendererState.compactConversations") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: ConversationCompactionStatusSchema.parse(
        await rendererStateStore.compactConversations(
          command.payload.force === undefined
            ? {}
            : { force: command.payload.force }
        )
      )
    };
  }
  if (command.type === "rendererState.releaseCompactionBackup") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: ConversationCompactionStatusSchema.parse(
        await rendererStateStore.releaseCompactionBackup()
      )
    };
  }
  return undefined;
}
