import {
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  type LibraryAgentProfile,
  type LibraryAgentWorkspaceSnapshot,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import {
  type LibraryDomain,
  type LibraryProfileShape,
  type LibraryWorkspaceShape,
  type MutableLibraryEntry,
  type MutableLibraryOverview
} from "./types";

export const MATERIAL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  character: ["character"],
  gimmick: ["gimmick"],
  plot: ["pacing", "intro", "plot_refine"],
  draft: ["draft_excerpt"],
  other: ["other"],
  mixed: MATERIAL_STAGE_IDS
};

export const SKILL_KIND_STAGE_IDS: Record<string, readonly string[]> = {
  general: SKILL_STAGE_IDS,
  plot: ["character_design", "plot_design", "outline"],
  style: ["draft", "expert_section_writer"],
  other: SKILL_STAGE_IDS
};

export function profileDomain(profile: LibraryAgentProfile): LibraryDomain {
  const value = profile as unknown as LibraryProfileShape;
  if (value.domain === "material" || value.domain === "skill")
    return value.domain;
  if (value.id?.includes("material")) return "material";
  if (value.id?.includes("skill")) return "skill";
  throw new Error("Library agent profile does not declare a supported domain.");
}

export function workspaceShape(
  workspace: LibraryAgentWorkspaceSnapshot
): LibraryWorkspaceShape {
  return workspace as unknown as LibraryWorkspaceShape;
}

export function workspaceDomain(
  workspace: LibraryAgentWorkspaceSnapshot
): LibraryDomain {
  const value = workspaceShape(workspace).domain;
  if (value === "material" || value === "skill") return value;
  throw new Error(
    "Library workspace snapshot does not declare a supported domain."
  );
}

export function libraryId(workspace: LibraryAgentWorkspaceSnapshot): string {
  const value = workspaceShape(workspace);
  const id = String(value.libraryId ?? value.id ?? "").trim();
  if (!id)
    throw new Error("Library workspace snapshot is missing its library id.");
  return id;
}

export function libraryTitle(workspace: LibraryAgentWorkspaceSnapshot): string {
  return (
    String(workspaceShape(workspace).title ?? "未命名资料库").trim() ||
    "未命名资料库"
  );
}

export function libraryProjectRevision(
  workspace: LibraryAgentWorkspaceSnapshot
): number | undefined {
  const value = workspaceShape(workspace);
  return value.projectRevision ?? value.baseProjectRevision;
}

export function omittedEntryCount(
  workspace: LibraryAgentWorkspaceSnapshot
): number {
  return Math.max(0, Number(workspaceShape(workspace).omittedEntryCount ?? 0));
}

export function isReadOnly(
  workspace: LibraryAgentWorkspaceSnapshot,
  profile: LibraryAgentProfile
): boolean {
  const value = workspaceShape(workspace);
  const profileValue = profile as unknown as LibraryProfileShape;
  return (
    value.readOnly === true ||
    value.isReadOnly === true ||
    profileValue.readOnly === true
  );
}

export function readableLibraries(
  workspace: LibraryAgentWorkspaceSnapshot
): Array<{ libraryId: string; title: string; kind: string }> {
  const value = workspaceShape(workspace);
  const currentId = libraryId(workspace);
  const currentTitle = libraryTitle(workspace);
  const currentKind = String(
    value.kind ??
      (workspaceDomain(workspace) === "material"
        ? value.materialKind
        : value.skillKind) ??
      "unknown"
  );
  const listed = (value.readableLibraries ?? [])
    .map((library) => ({
      libraryId: String(library.libraryId ?? library.id ?? "").trim(),
      title: String(library.title ?? "").trim() || "未命名资料库",
      kind: String(library.kind ?? "").trim() || "unknown"
    }))
    .filter((library) => library.libraryId);
  if (!listed.length) {
    return [{ libraryId: currentId, title: currentTitle, kind: currentKind }];
  }
  if (!listed.some((library) => library.libraryId === currentId)) {
    return [
      { libraryId: currentId, title: currentTitle, kind: currentKind },
      ...listed
    ];
  }
  return listed;
}

export function allowedStageIds(
  workspace: LibraryAgentWorkspaceSnapshot,
  domain: LibraryDomain
): string[] {
  const value = workspaceShape(workspace);
  const explicit = value.allowedStageIds ?? value.stageIds;
  if (explicit?.length)
    return [...new Set(explicit.map(String).filter(Boolean))];
  const kind = String(
    value.kind ??
      (domain === "material" ? value.materialKind : value.skillKind) ??
      ""
  );
  const byKind =
    domain === "material" ? MATERIAL_KIND_STAGE_IDS : SKILL_KIND_STAGE_IDS;
  return [
    ...(byKind[kind] ??
      (domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS))
  ];
}

export function mutableEntries(
  workspace: LibraryAgentWorkspaceSnapshot,
  libraryReadOnly: boolean
): MutableLibraryEntry[] {
  const currentLibraryId = libraryId(workspace);
  const currentLibraryTitle = libraryTitle(workspace);
  return (workspaceShape(workspace).entries ?? []).map((entry, index) => {
    const entryId = String(entry.entryId ?? entry.id ?? `entry-${index + 1}`);
    const content = String(entry.content ?? entry.body ?? "");
    const sourceLibraryId =
      String(entry.sourceLibraryId ?? currentLibraryId).trim() ||
      currentLibraryId;
    const sourceLibraryTitle =
      String(entry.sourceLibraryTitle ?? "").trim() ||
      (sourceLibraryId === currentLibraryId
        ? currentLibraryTitle
        : sourceLibraryId);
    return {
      entryId,
      documentId: String(entry.documentId ?? entryId),
      stageId: String(entry.stageId ?? ""),
      title: String(entry.title ?? "").trim() || "未命名条目",
      content,
      revision: String(
        entry.revision ?? createShortWorkspaceContentRevision(content)
      ),
      truncated: entry.truncated === true,
      ...(entry.originalLength === undefined
        ? {}
        : { originalLength: entry.originalLength }),
      readOnly:
        libraryReadOnly ||
        entry.readOnly === true ||
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
  const value = workspaceShape(workspace);
  const content = String(value.overview ?? "");
  return {
    documentId:
      String(value.overviewDocumentId ?? "").trim() ||
      `library:${workspaceDomain(workspace)}:${libraryId(workspace)}:overview`,
    content,
    revision:
      String(value.overviewRevision ?? "").trim() ||
      createShortWorkspaceContentRevision(content),
    truncated: value.overviewTruncated === true,
    ...(value.overviewOriginalLength === undefined
      ? {}
      : { originalLength: value.overviewOriginalLength })
  };
}
