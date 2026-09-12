import {
  ConversationExportBeginSchema,
  ConversationExportBeginResultSchema,
  ConversationExportAppendSchema,
  ConversationExportFinishSchema,
  ConversationExportTokenSchema,
  ConversationExportProgressSchema,
  ConversationExportFinishedSchema,
  ConversationExportCanceledSchema,
  createEnvelope,
  type ConversationExportApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
function identity() {
  const id = browserId("cmd_conversation_export");
  return { id, correlationId: id };
}
export const conversationExport: ConversationExportApi = {
  async begin(input) {
    return ConversationExportBeginResultSchema.parse(
      await invokeCommand(
        createEnvelope(
          "conversationExport.begin",
          ConversationExportBeginSchema.parse(input),
          identity()
        )
      )
    );
  },
  async append(input) {
    return ConversationExportProgressSchema.parse(
      await invokeCommand(
        createEnvelope(
          "conversationExport.append",
          ConversationExportAppendSchema.parse(input),
          identity()
        )
      )
    );
  },
  async finish(input) {
    return ConversationExportFinishedSchema.parse(
      await invokeCommand(
        createEnvelope(
          "conversationExport.finish",
          ConversationExportFinishSchema.parse(input),
          identity()
        )
      )
    );
  },
  async cancel(input) {
    ConversationExportCanceledSchema.parse(
      await invokeCommand(
        createEnvelope(
          "conversationExport.cancel",
          ConversationExportTokenSchema.parse(input),
          identity()
        )
      )
    );
  }
};
