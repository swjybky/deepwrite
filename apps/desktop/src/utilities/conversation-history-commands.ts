import {
  ConversationHistoryResultSchemas,
  type ConversationHistoryApi,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";

export async function handleConversationHistoryCommand(
  history: ConversationHistoryApi,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  let payload: unknown;
  switch (command.type) {
    case "rendererState.history.mergeScopes":
      payload = await history.mergeScopes(command.payload);
      break;
    case "rendererState.history.stage":
      payload = await history.stage(command.payload);
      break;
    case "rendererState.history.commit":
      payload = await history.commit(command.payload);
      break;
    case "rendererState.history.list":
      payload = await history.list(command.payload);
      break;
    case "rendererState.history.session":
      payload = await history.session(command.payload);
      break;
    case "rendererState.history.messages":
      payload = await history.messages(command.payload);
      break;
    case "rendererState.history.detail":
      payload = await history.detail(command.payload);
      break;
    case "rendererState.history.metadataDetail":
      payload = await history.metadataDetail(command.payload);
      break;
    case "rendererState.history.turns":
      payload = await history.turns(command.payload);
      break;
    default:
      return undefined;
  }
  return {
    status: "accepted",
    requestId: command.id,
    payload: ConversationHistoryResultSchemas[command.type].parse(payload)
  };
}
