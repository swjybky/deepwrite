import {
  ConversationHistoryMergeScopesQuerySchema,
  ConversationHistoryMergeScopesResultSchema,
  ConversationHistoryBatchSchema,
  ConversationHistoryCommitResultSchema,
  ConversationHistoryStageSchema,
  ConversationHistoryStageResultSchema,
  ConversationHistoryDetailQuerySchema,
  ConversationHistoryDetailResultSchema,
  ConversationHistoryMetadataDetailQuerySchema,
  ConversationHistoryListQuerySchema,
  ConversationHistoryListResultSchema,
  ConversationHistoryMessagesQuerySchema,
  ConversationHistoryMessagesResultSchema,
  ConversationHistorySessionQuerySchema,
  ConversationHistorySessionSchema,
  ConversationHistoryTurnsQuerySchema,
  ConversationHistoryTurnsResultSchema,
  createEnvelope,
  type ConversationHistoryApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

function commandIdentity() {
  const id = browserId("cmd_history");
  return { id, correlationId: id };
}

export const conversationHistory: ConversationHistoryApi = {
  async mergeScopes(input) {
    const payload = ConversationHistoryMergeScopesQuerySchema.parse(input);
    return ConversationHistoryMergeScopesResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.mergeScopes",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async metadataDetail(input) {
    const payload = ConversationHistoryMetadataDetailQuerySchema.parse(input);
    return ConversationHistoryDetailResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.metadataDetail",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async stage(input) {
    const payload = ConversationHistoryStageSchema.parse(input);
    return ConversationHistoryStageResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.stage",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async commit(input) {
    const payload = ConversationHistoryBatchSchema.parse(input);
    return ConversationHistoryCommitResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.commit",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async list(input) {
    const payload = ConversationHistoryListQuerySchema.parse(input);
    return ConversationHistoryListResultSchema.parse(
      await invokeCommand(
        createEnvelope("rendererState.history.list", payload, commandIdentity())
      )
    );
  },
  async session(input) {
    const payload = ConversationHistorySessionQuerySchema.parse(input);
    return ConversationHistorySessionSchema.nullable().parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.session",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async messages(input) {
    const payload = ConversationHistoryMessagesQuerySchema.parse(input);
    return ConversationHistoryMessagesResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.messages",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async detail(input) {
    const payload = ConversationHistoryDetailQuerySchema.parse(input);
    return ConversationHistoryDetailResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.detail",
          payload,
          commandIdentity()
        )
      )
    );
  },
  async turns(input) {
    const payload = ConversationHistoryTurnsQuerySchema.parse(input);
    return ConversationHistoryTurnsResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "rendererState.history.turns",
          payload,
          commandIdentity()
        )
      )
    );
  }
};
