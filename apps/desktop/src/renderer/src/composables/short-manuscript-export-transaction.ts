import type {
  Book,
  DeepWriteApi,
  ExportShortManuscriptResult
} from "@deepwrite/contracts";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  createShortManuscriptClipboardText,
  createShortManuscriptExportInput,
  type ShortManuscriptExportTarget
} from "../utils/shortManuscriptExport";

export type ShortManuscriptExportOutcome =
  ExportShortManuscriptResult | { status: "copied" };

export interface ShortManuscriptExportTransactionInput {
  target: ShortManuscriptExportTarget;
  book: Book;
  documents: readonly WorkspaceDocument[];
  drafts: Readonly<Record<string, EditorDraftState>>;
  api: DeepWriteApi["manuscript"] | undefined;
  writeClipboardText(text: string): Promise<void>;
}

/** Writes one hydrated manuscript projection to either a file or the clipboard. */
export async function executeShortManuscriptExport(
  transaction: ShortManuscriptExportTransactionInput
): Promise<ShortManuscriptExportOutcome> {
  const format =
    transaction.target === "clipboard" ? "txt" : transaction.target;
  const input = createShortManuscriptExportInput(
    transaction.book,
    transaction.documents,
    transaction.drafts,
    format
  );

  if (transaction.target === "clipboard") {
    await transaction.writeClipboardText(
      createShortManuscriptClipboardText(input)
    );
    return { status: "copied" };
  }
  if (!transaction.api) {
    throw new Error("正文导出服务不可用。");
  }
  return transaction.api.exportShort(input);
}
