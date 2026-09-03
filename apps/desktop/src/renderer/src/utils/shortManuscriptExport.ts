import type {
  ExportShortManuscriptInput,
  Book,
  ShortManuscriptExportFormat
} from "@deepwrite/contracts";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

export type ShortManuscriptExportTarget =
  ShortManuscriptExportFormat | "clipboard";

/**
 * Builds the reader-visible short manuscript in persisted section order.
 * Character-state documents are deliberately excluded, and live editor drafts
 * win over the last catalog snapshot so an export never silently goes stale.
 */
export function createShortManuscriptExportInput(
  book: Book,
  documents: readonly WorkspaceDocument[],
  editorDrafts: Readonly<Record<string, EditorDraftState>>,
  format: ShortManuscriptExportFormat
): ExportShortManuscriptInput {
  const bodyDocuments = new Map(
    documents
      .filter(
        (document) =>
          document.workspaceId === book.id &&
          document.draftFileKind === "body" &&
          Boolean(document.catalogDocumentId)
      )
      .map((document) => [document.catalogDocumentId!, document] as const)
  );

  return {
    title: book.title,
    format,
    sections: book.draft.sections.map((section) => {
      const document = bodyDocuments.get(section.body.id);
      const live = document ? editorDrafts[document.id] : undefined;
      return {
        title: live?.title.trim() || document?.title.trim() || section.title,
        content: live?.content ?? document?.content ?? section.body.content
      };
    })
  };
}

/**
 * Produces the plain-text manuscript placed on the system clipboard.
 * It intentionally mirrors TXT export ordering without copying a BOM.
 */
export function createShortManuscriptClipboardText(
  input: ExportShortManuscriptInput
): string {
  const content = [
    `《${input.title}》`,
    ...input.sections.flatMap((section) => [
      section.title,
      section.content.replace(/\r\n?/gu, "\n").trim()
    ])
  ].join("\n\n");
  return `${content}\n`;
}
