export interface DraftSectionCreationRevisionCursor {
  baseRevision: string;
  currentRevision: string;
}

export function draftSectionCreationRevisionKey(
  runId: string,
  workspaceId: string
): string {
  return `${runId}\u0000${workspaceId}`;
}

export function expectedDraftSectionCreationRevision(
  proposalBaseRevision: string,
  cursor: DraftSectionCreationRevisionCursor | undefined
): string {
  return cursor?.baseRevision === proposalBaseRevision
    ? cursor.currentRevision
    : proposalBaseRevision;
}

export function advanceDraftSectionCreationRevision(
  proposalBaseRevision: string,
  currentRevision: string,
  cursor: DraftSectionCreationRevisionCursor | undefined
): DraftSectionCreationRevisionCursor {
  return {
    baseRevision:
      cursor?.baseRevision === proposalBaseRevision
        ? cursor.baseRevision
        : proposalBaseRevision,
    currentRevision
  };
}
