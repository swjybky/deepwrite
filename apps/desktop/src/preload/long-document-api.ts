import {
  LongApplyOperationsInputSchema,
  LongApplyOperationsResultSchema,
  LongCommitChapterInputSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitInputSchema,
  LongDeleteLedgerCommitResultSchema,
  LongOpenBookInputSchema,
  LongPreviewOperationsInputSchema,
  LongPreviewOperationsResultSchema,
  LongReadAgentsMdInputSchema,
  LongReadAgentsMdResultSchema,
  LongReadDocumentInputSchema,
  LongReadDocumentResultSchema,
  LongSearchInputSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteAgentsMdInputSchema,
  LongWriteAgentsMdResultSchema,
  LongWriteChapterInputSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentInputSchema,
  LongWriteDocumentResultSchema,
  createEnvelope,
  type LongApplyOperationsInput,
  type LongApplyOperationsResult,
  type LongCommitChapterInput,
  type LongCommitChapterResult,
  type LongDeleteLedgerCommitInput,
  type LongDeleteLedgerCommitResult,
  type LongOpenBookInput,
  type LongPreviewOperationsInput,
  type LongPreviewOperationsResult,
  type LongReadAgentsMdInput,
  type LongReadAgentsMdResult,
  type LongReadDocumentInput,
  type LongReadDocumentResult,
  type LongSearchInput,
  type LongSearchResult,
  type LongWorkspaceIndexResult,
  type LongWriteAgentsMdInput,
  type LongWriteAgentsMdResult,
  type LongWriteChapterInput,
  type LongWriteChapterResult,
  type LongWriteDocumentInput,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

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
