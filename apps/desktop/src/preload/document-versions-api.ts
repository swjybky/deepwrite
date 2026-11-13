import {
  ListDocumentVersionsInputSchema,
  ListDocumentVersionsResultSchema,
  ReadDocumentVersionInputSchema,
  ReadDocumentVersionResultSchema,
  RestoreDocumentVersionInputSchema,
  RestoreDocumentVersionResultSchema,
  createEnvelope,
  type DocumentVersionsApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const versions: DocumentVersionsApi = {
  async list(rawInput) {
    const input = ListDocumentVersionsInputSchema.parse(rawInput);
    const id = browserId("cmd_versions_list");
    return ListDocumentVersionsResultSchema.parse(
      await invokeCommand(
        createEnvelope("versions.list", input, {
          id,
          correlationId: id,
          context: { resourceId: input.target.bookId }
        })
      )
    );
  },
  async read(rawInput) {
    const input = ReadDocumentVersionInputSchema.parse(rawInput);
    const id = browserId("cmd_versions_read");
    return ReadDocumentVersionResultSchema.parse(
      await invokeCommand(
        createEnvelope("versions.read", input, {
          id,
          correlationId: id,
          context: { resourceId: input.target.bookId }
        })
      )
    );
  },
  async restore(rawInput) {
    const input = RestoreDocumentVersionInputSchema.parse(rawInput);
    const id = browserId("cmd_versions_restore");
    return RestoreDocumentVersionResultSchema.parse(
      await invokeCommand(
        createEnvelope("versions.restore", input, {
          id,
          correlationId: id,
          context: { resourceId: input.target.bookId }
        })
      )
    );
  }
};
