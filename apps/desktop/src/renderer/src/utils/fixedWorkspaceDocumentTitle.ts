import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

/** Documents whose titles describe a structural slot instead of user content. */
export function workspaceDocumentHasFixedTitle(
  document: WorkspaceDocument
): boolean {
  return (
    document.draftFileKind === "character-state" ||
    document.draftFileKind === "brief" ||
    document.draftFileKind === "state" ||
    document.academicDocKind === "thesis_overview" ||
    document.academicDocKind === "terminology" ||
    document.academicDocKind === "framework_stage" ||
    document.catalogLibraryField === "overview" ||
    document.characterFileKind === "overview" ||
    document.plotStageOrder !== undefined
  );
}

export function resolveWorkspaceDocumentTitle(
  document: WorkspaceDocument,
  candidateTitle: string | undefined
): string {
  return workspaceDocumentHasFixedTitle(document)
    ? document.title
    : (candidateTitle ?? document.title);
}

export function normalizeFixedWorkspaceDocumentDraft(
  document: WorkspaceDocument,
  draft: EditorDraftState
): EditorDraftState {
  const title = resolveWorkspaceDocumentTitle(document, draft.title);
  return title === draft.title ? draft : { ...draft, title };
}
