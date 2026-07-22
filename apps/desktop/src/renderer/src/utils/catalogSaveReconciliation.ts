import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

export interface WorkspaceDocumentBaseline {
  title: string;
  content: string;
}

export function captureWorkspaceDocumentBaselines(
  documents: readonly WorkspaceDocument[],
  workspaceId: string
): ReadonlyMap<string, WorkspaceDocumentBaseline> {
  return new Map(
    documents.flatMap((document) =>
      document.workspaceId === workspaceId
        ? [[document.id, { title: document.title, content: document.content }] as const]
        : []
    )
  );
}

/**
 * Advances a recovery draft only when the refreshed disk document still equals
 * the persisted baseline observed immediately after save. If another writer
 * changed that file, the older base is deliberately retained so the next save
 * enters conflict handling instead of silently rebasing over the new text.
 */
export function rebaseDraftsForMatchingDocuments(
  drafts: Readonly<Record<string, EditorDraftState>>,
  documents: readonly WorkspaceDocument[],
  workspaceId: string,
  expected: ReadonlyMap<string, WorkspaceDocumentBaseline>,
  projectRevision: number | undefined,
  recoveryUpdatedAt: string
): Record<string, EditorDraftState> {
  let changed = false;
  const next = { ...drafts };
  for (const document of documents) {
    if (document.workspaceId !== workspaceId) continue;
    const draft = next[document.id];
    const baseline = expected.get(document.id);
    if (
      !draft?.dirty ||
      !baseline ||
      baseline.title !== document.title ||
      baseline.content !== document.content
    ) {
      continue;
    }
    next[document.id] = {
      ...draft,
      recoveryUpdatedAt,
      baseRevision: createShortWorkspaceContentRevision(document.content),
      ...(projectRevision === undefined
        ? {}
        : { baseProjectRevision: projectRevision })
    };
    changed = true;
  }
  return changed ? next : { ...drafts };
}
