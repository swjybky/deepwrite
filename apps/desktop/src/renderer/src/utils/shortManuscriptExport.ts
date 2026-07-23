import type {
  ExportShortManuscriptInput,
  ShortBook,
  ShortManuscriptExportFormat
} from "@deepwrite/contracts";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

/**
 * Builds the reader-visible short manuscript in persisted section order.
 * Character-state documents are deliberately excluded, and live editor drafts
 * win over the last catalog snapshot so an export never silently goes stale.
 */
export function createShortManuscriptExportInput(
  book: ShortBook,
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
