import {
  plotStructureCreationStageId,
  type DocumentVersionOrigin,
  type Book,
  type DeepWriteApi
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import type { AgentEditProposal } from "../../types/conversation";
import type {
  EditorDraftState,
  WorkspaceDocument
} from "../../types/workspace";
import type { CatalogDocumentPayload } from "../useCatalogDocumentPersistence";

const t = createScopedTranslator("workspace");

export interface PlotStructurePersistencePort {
  catalogBook(bookId: string): Book | undefined;
  loadCatalogSnapshot(): Promise<unknown>;
  documents(): readonly Pick<
    WorkspaceDocument,
    "id" | "workspaceId" | "catalogDocumentId"
  >[];
  applyAcceptedDocumentLocally(
    payload: CatalogDocumentPayload,
    savedProjectRevision: number | undefined,
    draftAtAccept: EditorDraftState | undefined
  ): void;
}

export { plotStructureCreationStageId } from "@deepwrite/contracts/renderer";

/** Save through Core, then publish the returned body over the metadata index. */
export async function persistPlotStructure(
  input: PlotStructurePersistencePort & {
    api: DeepWriteApi;
    book: Book;
    proposal: AgentEditProposal;
    versionOrigin?: DocumentVersionOrigin;
  }
): Promise<number | undefined> {
  const { api, book, proposal } = input;
  const mutation = proposal.plotStructureTarget!.mutation;
  const createdStageId =
    mutation.type === "create"
      ? plotStructureCreationStageId(proposal.id, mutation.provisionalStageId)
      : undefined;
  const updated = await api.catalog.mutatePlotStructure({
    bookId: proposal.workspaceId,
    // Force uses Core's latest serialized project state; the required legacy
    // revision field does not reject an otherwise applicable agent proposal.
    baseProjectRevision: book.projectRevision ?? 0,
    force: true,
    mutation:
      mutation.type === "create"
        ? {
            type: "create",
            stageId: createdStageId!,
            title: mutation.title,
            description: mutation.description
          }
        : {
            type: "update",
            stageId: mutation.stageId,
            title: mutation.title,
            description: mutation.description
          }
  });
  let saved:
    (Book["documents"][number] & Pick<Book, "projectRevision">) | undefined;
  if (mutation.type === "create") {
    const createdStage = updated.plotStages.find(
      ({ id }) => id === createdStageId
    );
    const createdDocument = updated.documents.find(
      ({ id }) => id === createdStageId
    );
    if (!createdStage || !createdDocument) {
      throw new Error(
        t("plotStructureLane.thePlotStructureWasCreatedButItsContentFile")
      );
    }
    const content = mutation.content.trim() ? mutation.content : "";
    if (createdDocument.content.trim() && createdDocument.content !== content) {
      throw new Error(
        t("plotStructureLane.theNewPlotStructureAlreadyHasDifferentContentThe")
      );
    }
    saved =
      createdDocument.content === content
        ? {
            ...createdDocument,
            ...(updated.projectRevision === undefined
              ? {}
              : { projectRevision: updated.projectRevision })
          }
        : await api.catalog.saveDocument({
            bookId: proposal.workspaceId,
            documentId: createdDocument.id,
            content,
            ...(input.versionOrigin
              ? { versionOrigin: input.versionOrigin }
              : {}),
            force: true
          });
  }

  await input.loadCatalogSnapshot();
  if (saved) {
    const refreshed = input.catalogBook(proposal.workspaceId);
    const document = input
      .documents()
      .find(
        (candidate) =>
          candidate.workspaceId === proposal.workspaceId &&
          candidate.catalogDocumentId === saved.id
      );
    if (
      !refreshed ||
      refreshed.bookType === "academic" ||
      !refreshed.plotStages.some(({ id }) => id === createdStageId) ||
      !refreshed.documents.some(({ id }) => id === saved.id) ||
      !document
    ) {
      throw new Error(
        t("plotStructureLane.thePlotStructureWasCreatedButItsContentFile2")
      );
    }
    // Catalog refreshes contain metadata only. The save result is the
    // authoritative body and must reach the editor before approval completes.
    input.applyAcceptedDocumentLocally(
      { id: document.id, title: saved.title, content: saved.content },
      saved.projectRevision,
      undefined
    );
  }
  return saved?.projectRevision ?? updated.projectRevision;
}
