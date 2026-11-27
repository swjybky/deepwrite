import {
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  type LibraryAgentProfile,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import {
  type LibraryDomain,
  type MutableLibraryEntry,
  type MutableLibraryOverview
} from "./types";

export const MATERIAL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  character: MATERIAL_STAGE_IDS,
  gimmick: MATERIAL_STAGE_IDS,
  plot: MATERIAL_STAGE_IDS,
  draft: MATERIAL_STAGE_IDS,
  other: MATERIAL_STAGE_IDS,
  mixed: MATERIAL_STAGE_IDS
};

export const SKILL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  general: SKILL_STAGE_IDS,
  plot: SKILL_STAGE_IDS,
  style: SKILL_STAGE_IDS,
  other: SKILL_STAGE_IDS
};

export function profileDomain(profile: LibraryAgentProfile): LibraryDomain {
  if (profile.domain === "material" || profile.domain === "skill")
    return profile.domain;
  throw new Error("Library agent profile does not declare a supported domain.");
}

export function workspaceDomain(
  workspace: LibraryAgentWorkspaceSnapshot
): LibraryDomain {
  return workspace.domain;
}

export function libraryId(workspace: LibraryAgentWorkspaceSnapshot): string {
  return workspace.libraryId;
}

export function libraryTitle(workspace: LibraryAgentWorkspaceSnapshot): string {
  return workspace.title;
}

export function libraryProjectRevision(
  workspace: LibraryAgentWorkspaceSnapshot
): number | undefined {
  return workspace.projectRevision;
}

export function omittedEntryCount(
  workspace: LibraryAgentWorkspaceSnapshot
): number {
  return workspace.omittedEntryCount ?? 0;
}

export function readableLibraries(
  workspace: LibraryAgentWorkspaceSnapshot
): Array<{ libraryId: string; title: string; kind: string }> {
  const current = {
    libraryId: workspace.libraryId,
    title: workspace.title,
    kind: workspace.customTag ?? workspace.kind
  };
  const listed = (workspace.readableLibraries ?? []).map((library) => ({
    libraryId: library.libraryId,
    title: library.title,
    kind: library.customTag ?? library.kind
  }));
  if (!listed.length) return [current];
  if (!listed.some((library) => library.libraryId === current.libraryId))
    return [current, ...listed];
  return listed;
}

export function allowedStageIds(domain: LibraryDomain): string[] {
  return [...(domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS)];
}

export function mutableEntries(
  workspace: LibraryAgentWorkspaceSnapshot,
  libraryReadOnly: boolean
): MutableLibraryEntry[] {
  const currentLibraryId = workspace.libraryId;
  return workspace.entries.map((entry) => {
    const sourceLibraryId = entry.sourceLibraryId ?? currentLibraryId;
    const sourceLibraryTitle =
      entry.sourceLibraryTitle ??
      (sourceLibraryId === currentLibraryId
        ? workspace.title
        : sourceLibraryId);
    return {
      entryId: entry.id,
      documentId: entry.documentId,
      stageId: entry.stageId,
      title: entry.title,
      content: entry.content,
      revision: entry.revision,
      truncated: entry.truncated === true,
      ...(entry.originalLength === undefined
        ? {}
        : { originalLength: entry.originalLength }),
      readOnly:
        libraryReadOnly ||
        entry.readOnly ||
        sourceLibraryId !== currentLibraryId,
      pendingCreate: false,
      sourceLibraryId,
      sourceLibraryTitle,
      isCurrentLibrary: sourceLibraryId === currentLibraryId
    };
  });
}

export function mutableOverview(
  workspace: LibraryAgentWorkspaceSnapshot
): MutableLibraryOverview {
  return {
    documentId: workspace.overviewDocumentId,
    content: workspace.overview,
    revision: workspace.overviewRevision,
    truncated: workspace.overviewTruncated === true,
    ...(workspace.overviewOriginalLength === undefined
      ? {}
      : { originalLength: workspace.overviewOriginalLength })
  };
}
