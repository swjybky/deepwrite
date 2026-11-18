import {
  CreateMysteryBookInputSchema,
  MysteryAgentIdSchema,
  MysteryAgentSettingsInputSchema,
  MysteryAgentSettingsSchema,
  MysteryApplyOperationsInputSchema,
  MysteryApplyOperationsResultSchema,
  MysteryDuplicateBookInputSchema,
  MysteryExportBundleInputSchema,
  MysteryExportBundleResultSchema,
  MysteryListBooksResultSchema,
  MysteryOpenBookInputSchema,
  MysteryOpenBookResultSchema,
  MysteryPreviewOperationsInputSchema,
  MysteryPreviewOperationsResultSchema,
  MysteryReadAgentsMdInputSchema,
  MysteryReadAgentsMdResultSchema,
  MysteryReadDocumentInputSchema,
  MysteryReadDocumentResultSchema,
  MysteryRemoveBookInputSchema,
  MysteryRemoveBookResultSchema,
  MysteryRenameBookInputSchema,
  MysteryRestoreOperationsInputSchema,
  MysteryRestoreOperationsResultSchema,
  MysterySearchInputSchema,
  MysterySearchResultSchema,
  MysteryUpdateBindingsInputSchema,
  MysteryWorkspaceIndexResultSchema,
  MysteryWriteAgentsMdInputSchema,
  MysteryWriteAgentsMdResultSchema,
  MysteryWriteDocumentInputSchema,
  MysteryWriteDocumentResultSchema,
  createEnvelope,
  type CreateMysteryBookInput,
  type DeepWriteApi,
  type MysteryAgentId,
  type MysteryAgentSettings,
  type MysteryAgentSettingsInput,
  type MysteryApplyOperationsInput,
  type MysteryApplyOperationsResult,
  type MysteryDuplicateBookInput,
  type MysteryExportBundleInput,
  type MysteryExportBundleResult,
  type MysteryListBooksResult,
  type MysteryOpenBookInput,
  type MysteryOpenBookResult,
  type MysteryPreviewOperationsInput,
  type MysteryPreviewOperationsResult,
  type MysteryReadAgentsMdInput,
  type MysteryReadAgentsMdResult,
  type MysteryReadDocumentInput,
  type MysteryReadDocumentResult,
  type MysteryRemoveBookInput,
  type MysteryRemoveBookResult,
  type MysteryRenameBookInput,
  type MysteryRestoreOperationsInput,
  type MysteryRestoreOperationsResult,
  type MysterySearchInput,
  type MysterySearchResult,
  type MysteryUpdateBindingsInput,
  type MysteryWorkspaceIndexResult,
  type MysteryWriteAgentsMdInput,
  type MysteryWriteAgentsMdResult,
  type MysteryWriteDocumentInput,
  type MysteryWriteDocumentResult
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const mystery: NonNullable<DeepWriteApi["mystery"]> = {
  async list(): Promise<MysteryListBooksResult> {
    const id = browserId("cmd_mystery_list");
    return MysteryListBooksResultSchema.parse(
      await invokeCommand<MysteryListBooksResult>(
        createEnvelope("mystery.list", {}, { id, correlationId: id })
      )
    );
  },

  async createBook(
    rawInput: CreateMysteryBookInput
  ): Promise<MysteryOpenBookResult | null> {
    const input = CreateMysteryBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_create");
    const result = await invokeCommand<MysteryOpenBookResult | null>(
      createEnvelope("mystery.createBook", input, { id, correlationId: id })
    );
    return result === null ? null : MysteryOpenBookResultSchema.parse(result);
  },

  async open(rawInput: MysteryOpenBookInput): Promise<MysteryOpenBookResult> {
    const input = MysteryOpenBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_open");
    return MysteryOpenBookResultSchema.parse(
      await invokeCommand<MysteryOpenBookResult>(
        createEnvelope("mystery.open", input, { id, correlationId: id })
      )
    );
  },

  async openExisting(): Promise<MysteryOpenBookResult | null> {
    const id = browserId("cmd_mystery_open_existing");
    const result = await invokeCommand<MysteryOpenBookResult | null>(
      createEnvelope("mystery.openExisting", {}, { id, correlationId: id })
    );
    return result === null ? null : MysteryOpenBookResultSchema.parse(result);
  },

  async duplicateBook(
    rawInput: MysteryDuplicateBookInput
  ): Promise<MysteryOpenBookResult> {
    const input = MysteryDuplicateBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_dup");
    return MysteryOpenBookResultSchema.parse(
      await invokeCommand<MysteryOpenBookResult>(
        createEnvelope("mystery.duplicateBook", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async rename(
    rawInput: MysteryRenameBookInput
  ): Promise<MysteryOpenBookResult> {
    const input = MysteryRenameBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_rename");
    return MysteryOpenBookResultSchema.parse(
      await invokeCommand<MysteryOpenBookResult>(
        createEnvelope("mystery.rename", input, { id, correlationId: id })
      )
    );
  },

  async updateBindings(
    rawInput: MysteryUpdateBindingsInput
  ): Promise<MysteryOpenBookResult> {
    const input = MysteryUpdateBindingsInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_bindings");
    return MysteryOpenBookResultSchema.parse(
      await invokeCommand<MysteryOpenBookResult>(
        createEnvelope("mystery.updateBindings", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async getWorkspaceIndex(
    rawInput: MysteryOpenBookInput
  ): Promise<MysteryWorkspaceIndexResult> {
    const input = MysteryOpenBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_index");
    return MysteryWorkspaceIndexResultSchema.parse(
      await invokeCommand<MysteryWorkspaceIndexResult>(
        createEnvelope("mystery.getWorkspaceIndex", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async readDocument(
    rawInput: MysteryReadDocumentInput
  ): Promise<MysteryReadDocumentResult> {
    const input = MysteryReadDocumentInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_read_doc");
    return MysteryReadDocumentResultSchema.parse(
      await invokeCommand<MysteryReadDocumentResult>(
        createEnvelope("mystery.readDocument", input, { id, correlationId: id })
      )
    );
  },

  async writeDocument(
    rawInput: MysteryWriteDocumentInput
  ): Promise<MysteryWriteDocumentResult> {
    const input = MysteryWriteDocumentInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_write_doc");
    return MysteryWriteDocumentResultSchema.parse(
      await invokeCommand<MysteryWriteDocumentResult>(
        createEnvelope("mystery.writeDocument", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async readAgentsMd(
    rawInput: MysteryReadAgentsMdInput
  ): Promise<MysteryReadAgentsMdResult> {
    const input = MysteryReadAgentsMdInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_read_agents");
    return MysteryReadAgentsMdResultSchema.parse(
      await invokeCommand<MysteryReadAgentsMdResult>(
        createEnvelope("mystery.readAgentsMd", input, { id, correlationId: id })
      )
    );
  },

  async writeAgentsMd(
    rawInput: MysteryWriteAgentsMdInput
  ): Promise<MysteryWriteAgentsMdResult> {
    const input = MysteryWriteAgentsMdInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_write_agents");
    return MysteryWriteAgentsMdResultSchema.parse(
      await invokeCommand<MysteryWriteAgentsMdResult>(
        createEnvelope("mystery.writeAgentsMd", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async search(rawInput: MysterySearchInput): Promise<MysterySearchResult> {
    const input = MysterySearchInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_search");
    return MysterySearchResultSchema.parse(
      await invokeCommand<MysterySearchResult>(
        createEnvelope("mystery.search", input, { id, correlationId: id })
      )
    );
  },

  async previewOperations(
    rawInput: MysteryPreviewOperationsInput
  ): Promise<MysteryPreviewOperationsResult> {
    const input = MysteryPreviewOperationsInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_preview");
    return MysteryPreviewOperationsResultSchema.parse(
      await invokeCommand<MysteryPreviewOperationsResult>(
        createEnvelope("mystery.previewOperations", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async applyOperations(
    rawInput: MysteryApplyOperationsInput
  ): Promise<MysteryApplyOperationsResult> {
    const input = MysteryApplyOperationsInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_apply");
    return MysteryApplyOperationsResultSchema.parse(
      await invokeCommand<MysteryApplyOperationsResult>(
        createEnvelope("mystery.applyOperations", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async restoreOperations(
    rawInput: MysteryRestoreOperationsInput
  ): Promise<MysteryRestoreOperationsResult> {
    const input = MysteryRestoreOperationsInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_restore");
    return MysteryRestoreOperationsResultSchema.parse(
      await invokeCommand<MysteryRestoreOperationsResult>(
        createEnvelope("mystery.restoreOperations", input, {
          id,
          correlationId: id
        })
      )
    );
  },

  async unregister(
    rawInput: MysteryRemoveBookInput
  ): Promise<MysteryRemoveBookResult> {
    const input = MysteryRemoveBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_unreg");
    return MysteryRemoveBookResultSchema.parse(
      await invokeCommand<MysteryRemoveBookResult>(
        createEnvelope("mystery.unregister", input, { id, correlationId: id })
      )
    );
  },

  async delete(
    rawInput: MysteryRemoveBookInput
  ): Promise<MysteryRemoveBookResult> {
    const input = MysteryRemoveBookInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_delete");
    return MysteryRemoveBookResultSchema.parse(
      await invokeCommand<MysteryRemoveBookResult>(
        createEnvelope("mystery.delete", input, { id, correlationId: id })
      )
    );
  },

  async exportBundle(
    rawInput: MysteryExportBundleInput
  ): Promise<MysteryExportBundleResult> {
    const input = MysteryExportBundleInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_export");
    return MysteryExportBundleResultSchema.parse(
      await invokeCommand<MysteryExportBundleResult>(
        createEnvelope("mystery.exportBundle", input, { id, correlationId: id })
      )
    );
  },

  async listAgents(): Promise<MysteryAgentSettings> {
    const id = browserId("cmd_mystery_agents_list");
    return MysteryAgentSettingsSchema.parse(
      await invokeCommand<MysteryAgentSettings>(
        createEnvelope("mysteryAgents.list", {}, { id, correlationId: id })
      )
    );
  },

  async saveAgents(
    rawInput: MysteryAgentSettingsInput
  ): Promise<MysteryAgentSettings> {
    const input = MysteryAgentSettingsInputSchema.parse(rawInput);
    const id = browserId("cmd_mystery_agents_save");
    return MysteryAgentSettingsSchema.parse(
      await invokeCommand<MysteryAgentSettings>(
        createEnvelope("mysteryAgents.save", input, { id, correlationId: id })
      )
    );
  },

  async resetAgents(
    rawAgentId?: MysteryAgentId
  ): Promise<MysteryAgentSettings> {
    const agentId = rawAgentId
      ? MysteryAgentIdSchema.parse(rawAgentId)
      : undefined;
    const id = browserId("cmd_mystery_agents_reset");
    return MysteryAgentSettingsSchema.parse(
      await invokeCommand<MysteryAgentSettings>(
        createEnvelope("mysteryAgents.reset", agentId ? { agentId } : {}, {
          id,
          correlationId: id
        })
      )
    );
  }
};
