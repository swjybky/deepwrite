import type {
  MysteryAgentId,
  MysteryAgentSettings,
  MysteryAgentSettingsInput
} from "./agent-settings";
import type {
  CreateMysteryBookInput,
  MysteryDuplicateBookInput,
  MysteryListBooksResult,
  MysteryOpenBookInput,
  MysteryOpenBookResult,
  MysteryPreviewOperationsInput,
  MysteryReadAgentsMdInput,
  MysteryReadAgentsMdResult,
  MysteryReadDocumentInput,
  MysteryReadDocumentResult,
  MysteryRemoveBookInput,
  MysteryRemoveBookResult,
  MysteryRenameBookInput,
  MysteryRestoreOperationsInput,
  MysteryUpdateBindingsInput,
  MysteryWorkspaceIndexResult,
  MysteryWriteAgentsMdInput,
  MysteryWriteAgentsMdResult,
  MysteryWriteDocumentInput
} from "./commands";
import type {
  MysteryApplyOperationsInput,
  MysteryApplyOperationsResult,
  MysteryExportBundleInput,
  MysteryExportBundleResult,
  MysteryPreviewOperationsResult,
  MysteryRestoreOperationsResult,
  MysterySearchInput,
  MysterySearchResult,
  MysteryWriteDocumentResult
} from "./operations";

export interface MysteryPreloadApi {
  list(): Promise<MysteryListBooksResult>;
  createBook(
    input: CreateMysteryBookInput
  ): Promise<MysteryOpenBookResult | null>;
  open(input: MysteryOpenBookInput): Promise<MysteryOpenBookResult>;
  openExisting(): Promise<MysteryOpenBookResult | null>;
  duplicateBook(
    input: MysteryDuplicateBookInput
  ): Promise<MysteryOpenBookResult>;
  rename(input: MysteryRenameBookInput): Promise<MysteryOpenBookResult>;
  updateBindings(
    input: MysteryUpdateBindingsInput
  ): Promise<MysteryOpenBookResult>;
  getWorkspaceIndex(
    input: MysteryOpenBookInput
  ): Promise<MysteryWorkspaceIndexResult>;
  readDocument(
    input: MysteryReadDocumentInput
  ): Promise<MysteryReadDocumentResult>;
  writeDocument(
    input: MysteryWriteDocumentInput
  ): Promise<MysteryWriteDocumentResult>;
  readAgentsMd(
    input: MysteryReadAgentsMdInput
  ): Promise<MysteryReadAgentsMdResult>;
  writeAgentsMd(
    input: MysteryWriteAgentsMdInput
  ): Promise<MysteryWriteAgentsMdResult>;
  search(input: MysterySearchInput): Promise<MysterySearchResult>;
  previewOperations(
    input: MysteryPreviewOperationsInput
  ): Promise<MysteryPreviewOperationsResult>;
  applyOperations(
    input: MysteryApplyOperationsInput
  ): Promise<MysteryApplyOperationsResult>;
  restoreOperations(
    input: MysteryRestoreOperationsInput
  ): Promise<MysteryRestoreOperationsResult>;
  unregister(input: MysteryRemoveBookInput): Promise<MysteryRemoveBookResult>;
  delete(input: MysteryRemoveBookInput): Promise<MysteryRemoveBookResult>;
  exportBundle(
    input: MysteryExportBundleInput
  ): Promise<MysteryExportBundleResult>;
  listAgents(): Promise<MysteryAgentSettings>;
  saveAgents(input: MysteryAgentSettingsInput): Promise<MysteryAgentSettings>;
  resetAgents(agentId?: MysteryAgentId): Promise<MysteryAgentSettings>;
}
