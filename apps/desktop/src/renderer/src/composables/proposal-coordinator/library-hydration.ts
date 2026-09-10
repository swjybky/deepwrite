import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
type LibraryEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "library.editor_mutation" }
>;

/** Hydrate the unopened library document without navigating away from writing. */
export async function hydrateLibraryProposalDocument(
  context: ProposalCoordinatorContext,
  event: LibraryEditorMutationEvent,
  disposed: () => boolean
): Promise<void> {
  const payload = event.payload;
  if (payload.operation === "create") return;
  const initial = context.editor.documents.value.find(
    (document) => document.id === payload.documentId
  );
  if (!initial || initial.catalogContentLoaded !== false) return;
  const api = context.api();
  if (!api) throw new Error("资料库文件服务当前不可用。");
  const loaded = await api.catalog.readDocument(
    payload.operation === "edit-overview"
      ? { projectId: payload.libraryId, target: "overview" }
      : {
          projectId: payload.libraryId,
          target: "document",
          documentId: payload.entryId
        }
  );
  if (disposed()) return;
  const current = context.editor.documents.value.find(
    (document) => document.id === initial.id
  );
  if (!current || current.catalogContentStamp !== initial.catalogContentStamp)
    throw new Error("资料库内容版本已变化，请重新生成。");
  if (current.catalogContentLoaded !== false) return;
  context.editor.documents.value = context.editor.documents.value.map(
    (document) =>
      document.id === current.id
        ? {
            ...document,
            content: loaded.content,
            catalogContentLoaded: true,
            catalogProjectRevision: loaded.projectRevision
          }
        : document
  );
}
