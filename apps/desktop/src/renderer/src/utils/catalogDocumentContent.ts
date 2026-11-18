import { patchCatalogDocument } from "./patchCatalogDocument";
import { createScopedTranslator } from "../i18n";
import type {
  CatalogReadDocumentInput,
  CatalogReadDocumentResult,
  CatalogSnapshot
} from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";

const t = createScopedTranslator("workspace.catalogDocumentContent");

export interface CatalogDocumentReadDescriptor {
  input: CatalogReadDocumentInput;
  cacheKey: string;
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Resolves an editor projection back to its physical Catalog document without
 * depending on resource-tree position. The metadata stamp makes same-size
 * external file edits invalidate the body cache after an index refresh.
 */
export function catalogDocumentReadDescriptor(
  document: WorkspaceDocument
): CatalogDocumentReadDescriptor | undefined {
  let input: CatalogReadDocumentInput | undefined;
  if (document.workspaceId && document.catalogDocumentId) {
    input = {
      projectId: document.workspaceId,
      target: "document",
      documentId: document.catalogDocumentId
    };
  } else if (
    document.libraryId &&
    document.catalogLibraryField === "overview"
  ) {
    input = {
      projectId: document.libraryId,
      target: "overview"
    };
  } else if (document.libraryId && document.catalogEntryId) {
    input = {
      projectId: document.libraryId,
      target: "document",
      documentId: document.catalogEntryId
    };
  }
  if (!input) return undefined;

  const identity =
    input.target === "overview" ? "overview" : `document:${input.documentId}`;
  const version =
    document.catalogContentStamp ??
    `project-revision:${document.catalogProjectRevision ?? "unknown"}`;
  return {
    input,
    cacheKey: [
      "catalog-body-v1",
      keyPart(input.projectId),
      keyPart(identity),
      keyPart(version)
    ].join(":")
  };
}

export function applyCatalogDocumentResult(
  document: WorkspaceDocument,
  result: CatalogReadDocumentResult
): WorkspaceDocument {
  const descriptor = catalogDocumentReadDescriptor(document);
  if (!descriptor || descriptor.input.projectId !== result.projectId) {
    throw new Error(t("catalogContentDoesNotMatchTheWorkspaceDocument"));
  }
  if (
    descriptor.input.target !== result.target ||
    (descriptor.input.target === "document" &&
      (result.target !== "document" ||
        descriptor.input.documentId !== result.documentId))
  ) {
    throw new Error(t("theCatalogContentTargetDoesNotMatchTheWorkspace"));
  }
  return patchCatalogDocument(document, {
    content: result.content,
    catalogContentBytes: result.contentBytes,
    catalogContentLoaded: true,
    catalogProjectRevision: result.projectRevision
  });
}

/**
 * Creates an ephemeral agent-context snapshot from the metadata index plus
 * the bounded set of bodies already loaded by the Renderer. It never mutates
 * the published Catalog index or re-runs the resource-tree projection.
 */
export function catalogSnapshotWithDocumentContents(
  snapshot: CatalogSnapshot,
  documents: readonly WorkspaceDocument[]
): CatalogSnapshot {
  const bookBodies = new Map<string, string>();
  const libraryBodies = new Map<string, string>();
  for (const document of documents) {
    if (document.catalogContentLoaded === false) continue;
    if (document.workspaceId && document.catalogDocumentId) {
      bookBodies.set(
        `${document.workspaceId}\u0000${document.catalogDocumentId}`,
        document.content
      );
    } else if (
      document.libraryId &&
      document.catalogLibraryField === "overview"
    ) {
      libraryBodies.set(
        `${document.domain}\u0000${document.libraryId}\u0000overview`,
        document.content
      );
    } else if (document.libraryId && document.catalogEntryId) {
      libraryBodies.set(
        `${document.domain}\u0000${document.libraryId}\u0000${document.catalogEntryId}`,
        document.content
      );
    }
  }
  const hydrateBookDocument = <
    Document extends { id: string; content: string }
  >(
    bookId: string,
    document: Document
  ): Document => ({
    ...document,
    content: bookBodies.get(`${bookId}\u0000${document.id}`) ?? document.content
  });
  return {
    ...snapshot,
    books: snapshot.books.map((book) =>
      book.bookType === "academic"
        ? {
            ...book,
            foundation: {
              thesisOverview: hydrateBookDocument(
                book.id,
                book.foundation.thesisOverview
              ),
              terminology: hydrateBookDocument(
                book.id,
                book.foundation.terminology
              ),
              cards: book.foundation.cards.map((card) => ({
                ...card,
                document: hydrateBookDocument(book.id, card.document)
              }))
            },
            documents: book.documents.map((document) =>
              hydrateBookDocument(book.id, document)
            ),
            manuscript: {
              ...book.manuscript,
              sections: book.manuscript.sections.map((section) => ({
                ...section,
                brief: hydrateBookDocument(book.id, section.brief),
                body: hydrateBookDocument(book.id, section.body),
                state: hydrateBookDocument(book.id, section.state)
              }))
            }
          }
        : {
            ...book,
            documents: book.documents.map((document) =>
              hydrateBookDocument(book.id, document)
            ),
            draft: {
              ...book.draft,
              sections: book.draft.sections.map((section) => ({
                ...section,
                body: hydrateBookDocument(book.id, section.body),
                characterState: hydrateBookDocument(
                  book.id,
                  section.characterState
                )
              }))
            }
          }
    ),
    materials: snapshot.materials.map((library) => ({
      ...library,
      overview:
        libraryBodies.get(`material\u0000${library.id}\u0000overview`) ??
        library.overview,
      entries: library.entries.map((entry) => ({
        ...entry,
        body:
          libraryBodies.get(`material\u0000${library.id}\u0000${entry.id}`) ??
          entry.body
      }))
    })),
    skills: snapshot.skills.map((library) => ({
      ...library,
      overview:
        libraryBodies.get(`skill\u0000${library.id}\u0000overview`) ??
        library.overview,
      entries: library.entries.map((entry) => ({
        ...entry,
        body:
          libraryBodies.get(`skill\u0000${library.id}\u0000${entry.id}`) ??
          entry.body
      }))
    }))
  };
}
