import type {
  CreateLongBookInput,
  LongDuplicateBookInput,
  LongImportPortableResult,
  LongApplyLegacySyncInput,
  LongApplyLegacySyncResult,
  LongChooseLegacySyncSourceResult,
  LongChooseContinuationImportSourceResult,
  LongImportContinuationInput,
  LongImportContinuationResult,
  LongApplyOperationsInput,
  LongApplyOperationsResult,
  LongListBooksResult,
  LongOpenBookInput,
  LongOpenBookResult,
  LongPreviewOperationsInput,
  LongPreviewOperationsResult,
  LongReadDocumentInput,
  LongReadDocumentResult,
  LongReadAgentsMdInput,
  LongReadAgentsMdResult,
  LongRenameBookInput,
  LongRemoveBookInput,
  LongRemoveBookResult,
  LongSearchInput,
  LongSearchResult,
  LongUpdateBindingsInput,
  LongWorkspaceIndexResult,
  LongWriteDocumentInput,
  LongWriteDocumentResult,
  LongWriteAgentsMdInput,
  LongWriteAgentsMdResult
} from "./long-workspace-api";
import type {
  LongCommitChapterInput,
  LongCommitChapterResult,
  LongDeleteLedgerCommitInput,
  LongDeleteLedgerCommitResult,
  LongWriteChapterInput,
  LongWriteChapterResult
} from "./long-ledger";
import type {
  LongResolveConflictsInput,
  LongResolveConflictsResult
} from "./long-project-recovery";
export interface LongPreloadApi {
  resolveConflicts(
    input: LongResolveConflictsInput
  ): Promise<LongResolveConflictsResult>;
  list(): Promise<LongListBooksResult>;
  create(input: CreateLongBookInput): Promise<LongOpenBookResult | null>;
  duplicateBook(input: LongDuplicateBookInput): Promise<LongOpenBookResult>;
  chooseLegacySyncSource(): Promise<LongChooseLegacySyncSourceResult | null>;
  applyLegacySync(
    input: LongApplyLegacySyncInput
  ): Promise<LongApplyLegacySyncResult>;
  importPortable(): Promise<LongImportPortableResult | null>;
  chooseContinuationImportSource(): Promise<LongChooseContinuationImportSourceResult | null>;
  importContinuation(
    input: LongImportContinuationInput
  ): Promise<LongImportContinuationResult | null>;
  open(input: LongOpenBookInput): Promise<LongOpenBookResult>;
  rename(input: LongRenameBookInput): Promise<LongOpenBookResult>;
  updateBindings(input: LongUpdateBindingsInput): Promise<LongOpenBookResult>;
  openExisting(): Promise<LongOpenBookResult | null>;
  getWorkspaceIndex(
    input: LongOpenBookInput
  ): Promise<LongWorkspaceIndexResult>;
  readDocument(input: LongReadDocumentInput): Promise<LongReadDocumentResult>;
  search(input: LongSearchInput): Promise<LongSearchResult>;
  writeDocument(
    input: LongWriteDocumentInput
  ): Promise<LongWriteDocumentResult>;
  readAgentsMd(input: LongReadAgentsMdInput): Promise<LongReadAgentsMdResult>;
  writeAgentsMd(
    input: LongWriteAgentsMdInput
  ): Promise<LongWriteAgentsMdResult>;
  previewOperations(
    input: LongPreviewOperationsInput
  ): Promise<LongPreviewOperationsResult>;
  applyOperations(
    input: LongApplyOperationsInput
  ): Promise<LongApplyOperationsResult>;
  writeChapter(input: LongWriteChapterInput): Promise<LongWriteChapterResult>;
  commitChapter(
    input: LongCommitChapterInput
  ): Promise<LongCommitChapterResult>;
  deleteLedgerCommit(
    input: LongDeleteLedgerCommitInput
  ): Promise<LongDeleteLedgerCommitResult>;
  unregister(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
  delete(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
}
