import {
  CreateLongBookInputSchema,
  LongApplyLegacySyncInputSchema,
  LongApplyLegacySyncResultSchema,
  LongChooseContinuationImportSourceResultSchema,
  LongChooseLegacySyncSourceResultSchema,
  LongDuplicateBookInputSchema,
  LongImportContinuationInputSchema,
  LongImportContinuationResultSchema,
  LongImportPortableResultSchema,
  LongListBooksResultSchema,
  LongOpenBookInputSchema,
  LongOpenBookResultSchema,
  LongRemoveBookInputSchema,
  LongRemoveBookResultSchema,
  LongRenameBookInputSchema,
  LongUpdateBindingsInputSchema,
  createEnvelope,
  type CreateLongBookInput,
  type LongApplyLegacySyncInput,
  type LongApplyLegacySyncResult,
  type LongChooseContinuationImportSourceResult,
  type LongChooseLegacySyncSourceResult,
  type LongDuplicateBookInput,
  type LongImportContinuationInput,
  type LongImportContinuationResult,
  type LongImportPortableResult,
  type LongListBooksResult,
  type LongOpenBookInput,
  type LongOpenBookResult,
  type LongRemoveBookInput,
  type LongRemoveBookResult,
  type LongRenameBookInput,
  type LongUpdateBindingsInput
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
