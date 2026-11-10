import { createScopedTranslator } from "../../i18n";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import type { SystemEventEnvelope } from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.libraryHydration");
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
  await context.catalog.ensureDocumentLoaded(initial);
  if (disposed()) return;
  const current = context.editor.documents.value.find(
    (document) => document.id === initial.id
  );
  if (
    !current ||
    current.catalogContentLoaded === false ||
    current.catalogContentStamp !== initial.catalogContentStamp
  ) {
    throw new Error(
      t("theLibraryContentVersionChangedGenerateTheContentAgain")
    );
  }
}
