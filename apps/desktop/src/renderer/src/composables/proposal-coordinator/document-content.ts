import { createScopedTranslator } from "../../i18n";
import type { WorkspaceDocument } from "../../types/workspace";
import type { ProposalCoordinatorContext } from "./types";

const t = createScopedTranslator("workspace.workspaceResourceCoordinator");

/** Resolve the real body before using it for a version check, diff or undo. */
export async function loadProposalDocument(
  context: Pick<ProposalCoordinatorContext, "catalog" | "editor">,
  document: WorkspaceDocument
): Promise<WorkspaceDocument> {
  if (document.catalogContentLoaded === false) {
    await context.catalog.ensureDocumentLoaded(document);
  }
  const persisted = context.editor.documents.value.find(
    (candidate) => candidate.id === document.id
  );
  const live = context.editor.liveDocuments.value.find(
    (candidate) => candidate.id === document.id
  );
  // The shared loader validates identities and stamps while reading. A failed
  // or invalidated read must never turn its empty placeholder into a version.
  if (!persisted || persisted.catalogContentLoaded === false || !live) {
    throw new Error(t("failedToReadTheManuscriptSelectItAgainAnd"));
  }
  return live;
}
