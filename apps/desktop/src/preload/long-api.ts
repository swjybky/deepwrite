import {
  CreateLongBookInputSchema,
  LongApplyLegacySyncInputSchema,
  LongApplyLegacySyncResultSchema,
  LongApplyOperationsInputSchema,
  LongApplyOperationsResultSchema,
  LongChooseContinuationImportSourceResultSchema,
  LongChooseLegacySyncSourceResultSchema,
  LongCommitChapterInputSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitInputSchema,
  LongDeleteLedgerCommitResultSchema,
  LongDuplicateBookInputSchema,
  LongImportContinuationInputSchema,
  LongImportContinuationResultSchema,
  LongImportPortableResultSchema,
  LongListBooksResultSchema,
  LongOpenBookInputSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsInputSchema,
  LongPreviewOperationsResultSchema,
  LongReadAgentsMdInputSchema,
  LongReadAgentsMdResultSchema,
  LongReadDocumentInputSchema,
  LongReadDocumentResultSchema,
  LongRemoveBookInputSchema,
  LongRemoveBookResultSchema,
  LongRenameBookInputSchema,
  LongSearchInputSchema,
  LongSearchResultSchema,
  LongUpdateBindingsInputSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteAgentsMdInputSchema,
  LongWriteAgentsMdResultSchema,
  LongWriteChapterInputSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentInputSchema,
  LongWriteDocumentResultSchema,
  createEnvelope,
  type CreateLongBookInput,
  type DeepWriteApi,
  type LongApplyLegacySyncInput,
  type LongApplyLegacySyncResult,
  type LongApplyOperationsInput,
  type LongApplyOperationsResult,
  type LongChooseContinuationImportSourceResult,
  type LongChooseLegacySyncSourceResult,
  type LongCommitChapterInput,
  type LongCommitChapterResult,
  type LongDeleteLedgerCommitInput,
  type LongDeleteLedgerCommitResult,
  type LongDuplicateBookInput,
  type LongImportContinuationInput,
  type LongImportContinuationResult,
  type LongImportPortableResult,
  type LongListBooksResult,
  type LongOpenBookInput,
  type LongOpenBookResult,
  type LongPreviewOperationsInput,
  type LongPreviewOperationsResult,
  type LongReadAgentsMdInput,
  type LongReadAgentsMdResult,
  type LongReadDocumentInput,
  type LongReadDocumentResult,
  type LongRemoveBookInput,
  type LongRemoveBookResult,
  type LongRenameBookInput,
  type LongSearchInput,
  type LongSearchResult,
  type LongUpdateBindingsInput,
  type LongWorkspaceIndexResult,
  type LongWriteAgentsMdInput,
  type LongWriteAgentsMdResult,
  type LongWriteChapterInput,
  type LongWriteChapterResult,
  type LongWriteDocumentInput,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

export async function listLongBooks(): Promise<LongListBooksResult> {
  const id = browserId("cmd_long_list");
  return LongListBooksResultSchema.parse(
    await invokeCommand<LongListBooksResult>(
      createEnvelope("long.list", {}, { id, correlationId: id })
    )
  );
}
export async function createLongBook(
  rawInput: CreateLongBookInput
): Promise<LongOpenBookResult | null> {
  const input = CreateLongBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_create");
  return LongOpenBookResultSchema.nullable().parse(
    await invokeCommand<LongOpenBookResult | null>(
      createEnvelope("long.createBook", input, { id, correlationId: id })
    )
  );
}
export async function duplicateLongBook(
  rawInput: LongDuplicateBookInput
): Promise<LongOpenBookResult> {
  const input = LongDuplicateBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_duplicate");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.duplicateBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}
export async function updateLongBookBindings(
  rawInput: LongUpdateBindingsInput
): Promise<LongOpenBookResult> {
  const input = LongUpdateBindingsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_update_bindings");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.updateBindings", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}
export async function renameLongBook(
  rawInput: LongRenameBookInput
): Promise<LongOpenBookResult> {
  const input = LongRenameBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_rename");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.rename", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function chooseLegacySyncSource(): Promise<LongChooseLegacySyncSourceResult | null> {
  const id = browserId("cmd_long_choose_legacy_sync");
  return LongChooseLegacySyncSourceResultSchema.nullable().parse(
    await invokeCommand<LongChooseLegacySyncSourceResult | null>(
      createEnvelope(
        "long.chooseLegacySyncSource",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function applyLegacySync(
  rawInput: LongApplyLegacySyncInput
): Promise<LongApplyLegacySyncResult> {
  const input = LongApplyLegacySyncInputSchema.parse(rawInput);
  const id = browserId("cmd_long_apply_legacy_sync");
  return LongApplyLegacySyncResultSchema.parse(
    await invokeCommand<LongApplyLegacySyncResult>(
      createEnvelope("long.applyLegacySync", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function chooseContinuationImportSource(): Promise<LongChooseContinuationImportSourceResult | null> {
  const id = browserId("cmd_long_choose_continuation_import");
  return LongChooseContinuationImportSourceResultSchema.nullable().parse(
    await invokeCommand<LongChooseContinuationImportSourceResult | null>(
      createEnvelope(
        "long.chooseContinuationImportSource",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function importContinuationLongBook(
  rawInput: LongImportContinuationInput
): Promise<LongImportContinuationResult | null> {
  const input = LongImportContinuationInputSchema.parse(rawInput);
  const id = browserId("cmd_long_import_continuation");
  return LongImportContinuationResultSchema.nullable().parse(
    await invokeCommand<LongImportContinuationResult | null>(
      createEnvelope("long.importContinuation", input, {
        id,
        correlationId: id
      })
    )
  );
}

export async function importPortableLongBook(): Promise<LongImportPortableResult | null> {
  const id = browserId("cmd_long_import_portable");
  return LongImportPortableResultSchema.nullable().parse(
    await invokeCommand<LongImportPortableResult | null>(
      createEnvelope("long.importPortable", {}, { id, correlationId: id })
    )
  );
}

export async function openLongBook(
  rawInput: LongOpenBookInput
): Promise<LongOpenBookResult> {
  const input = LongOpenBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_open");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.open", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function openExistingLongBook(): Promise<LongOpenBookResult | null> {
  const id = browserId("cmd_long_open_existing");
  return LongOpenBookResultSchema.nullable().parse(
    await invokeCommand<LongOpenBookResult | null>(
      createEnvelope("long.openExisting", {}, { id, correlationId: id })
    )
  );
}

export async function getLongWorkspaceIndex(
  rawInput: LongOpenBookInput
): Promise<LongWorkspaceIndexResult> {
  const input = LongOpenBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_index");
  return LongWorkspaceIndexResultSchema.parse(
    await invokeCommand<LongWorkspaceIndexResult>(
      createEnvelope("long.getWorkspaceIndex", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function readLongDocument(
  rawInput: LongReadDocumentInput
): Promise<LongReadDocumentResult> {
  const input = LongReadDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_long_read");
  return LongReadDocumentResultSchema.parse(
    await invokeCommand<LongReadDocumentResult>(
      createEnvelope("long.readDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function writeLongDocument(
  rawInput: LongWriteDocumentInput
): Promise<LongWriteDocumentResult> {
  const input = LongWriteDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_long_write");
  return LongWriteDocumentResultSchema.parse(
    await invokeCommand<LongWriteDocumentResult>(
      createEnvelope("long.writeDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function readLongAgentsMd(
  rawInput: LongReadAgentsMdInput
): Promise<LongReadAgentsMdResult> {
  const input = LongReadAgentsMdInputSchema.parse(rawInput);
  const id = browserId("cmd_long_read_agents_md");
  return LongReadAgentsMdResultSchema.parse(
    await invokeCommand<LongReadAgentsMdResult>(
      createEnvelope("long.readAgentsMd", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function writeLongAgentsMd(
  rawInput: LongWriteAgentsMdInput
): Promise<LongWriteAgentsMdResult> {
  const input = LongWriteAgentsMdInputSchema.parse(rawInput);
  const id = browserId("cmd_long_write_agents_md");
  return LongWriteAgentsMdResultSchema.parse(
    await invokeCommand<LongWriteAgentsMdResult>(
      createEnvelope("long.writeAgentsMd", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function previewLongOperations(
  rawInput: LongPreviewOperationsInput
): Promise<LongPreviewOperationsResult> {
  const input = LongPreviewOperationsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_preview_operations");
  return LongPreviewOperationsResultSchema.parse(
    await invokeCommand<LongPreviewOperationsResult>(
      createEnvelope("long.previewOperations", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function applyLongOperations(
  rawInput: LongApplyOperationsInput
): Promise<LongApplyOperationsResult> {
  const input = LongApplyOperationsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_apply_operations");
  return LongApplyOperationsResultSchema.parse(
    await invokeCommand<LongApplyOperationsResult>(
      createEnvelope("long.applyOperations", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function writeLongChapter(
  rawInput: LongWriteChapterInput
): Promise<LongWriteChapterResult> {
  const input = LongWriteChapterInputSchema.parse(rawInput);
  const id = browserId("cmd_long_write_chapter");
  return LongWriteChapterResultSchema.parse(
    await invokeCommand<LongWriteChapterResult>(
      createEnvelope("long.writeChapter", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function commitLongChapter(
  rawInput: LongCommitChapterInput
): Promise<LongCommitChapterResult> {
  const input = LongCommitChapterInputSchema.parse(rawInput);
  const id = browserId("cmd_long_commit_chapter");
  return LongCommitChapterResultSchema.parse(
    await invokeCommand<LongCommitChapterResult>(
      createEnvelope("long.commitChapter", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function deleteLongLedgerCommit(
  rawInput: LongDeleteLedgerCommitInput
): Promise<LongDeleteLedgerCommitResult> {
  const input = LongDeleteLedgerCommitInputSchema.parse(rawInput);
  const id = browserId("cmd_long_delete_ledger_commit");
  return LongDeleteLedgerCommitResultSchema.parse(
    await invokeCommand<LongDeleteLedgerCommitResult>(
      createEnvelope("long.deleteLedgerCommit", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function unregisterLongBook(
  rawInput: LongRemoveBookInput
): Promise<LongRemoveBookResult> {
  const input = LongRemoveBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_unregister");
  return LongRemoveBookResultSchema.parse(
    await invokeCommand<LongRemoveBookResult>(
      createEnvelope("long.unregister", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function deleteLongBook(
  rawInput: LongRemoveBookInput
): Promise<LongRemoveBookResult> {
  const input = LongRemoveBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_delete");
  return LongRemoveBookResultSchema.parse(
    await invokeCommand<LongRemoveBookResult>(
      createEnvelope("long.delete", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function searchLongDocuments(
  rawInput: LongSearchInput
): Promise<LongSearchResult> {
  const input = LongSearchInputSchema.parse(rawInput);
  const id = browserId("cmd_long_search");
  return LongSearchResultSchema.parse(
    await invokeCommand<LongSearchResult>(
      createEnvelope("long.search", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export const long: DeepWriteApi["long"] = {
  list: listLongBooks,
  create: createLongBook,
  duplicateBook: duplicateLongBook,
  rename: renameLongBook,
  updateBindings: updateLongBookBindings,
  chooseLegacySyncSource,
  applyLegacySync,
  importPortable: importPortableLongBook,
  chooseContinuationImportSource,
  importContinuation: importContinuationLongBook,
  open: openLongBook,
  openExisting: openExistingLongBook,
  getWorkspaceIndex: getLongWorkspaceIndex,
  readDocument: readLongDocument,
  search: searchLongDocuments,
  writeDocument: writeLongDocument,
  readAgentsMd: readLongAgentsMd,
  writeAgentsMd: writeLongAgentsMd,
  previewOperations: previewLongOperations,
  applyOperations: applyLongOperations,
  writeChapter: writeLongChapter,
  commitChapter: commitLongChapter,
  deleteLedgerCommit: deleteLongLedgerCommit,
  unregister: unregisterLongBook,
  delete: deleteLongBook
};
