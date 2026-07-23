import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LIBRARY_AGENT_MAX_ENTRIES,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS,
  LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS,
  createShortWorkspaceContentRevision,
  type CatalogSnapshot,
  type LibraryAgentEntrySnapshot,
  type LibraryAgentReadableLibrary,
  type LibraryAgentWorkspaceSnapshot,
  type MaterialLibrary,
  type SkillLibrary
} from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";
import type { ComposerReferenceOption } from "../types/conversation";

const BACKGROUND_ENTRY_MAX_CHARACTERS = 20_000;

function takeSnapshotText(
  content: string,
  maximum: number
): {
  content: string;
  truncated?: true;
  originalLength?: number;
} {
  const snapshot = content.slice(0, Math.max(0, maximum));
  return content.length > snapshot.length
    ? { content: snapshot, truncated: true, originalLength: content.length }
    : { content: snapshot };
}

function catalogNodeId(...parts: string[]): string {
  return ["catalog", ...parts.map((part) => encodeURIComponent(part))].join(":");
}

function entryDocumentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return catalogNodeId(`${domain}-entry`, libraryId, entryId);
}

function peerEntrySnapshotId(libraryId: string, entryId: string): string {
  return `${libraryId}/${entryId}`;
}

type CatalogLibrary = MaterialLibrary | SkillLibrary;

interface ResolvedLibrarySource {
  library: CatalogLibrary;
  kind: string;
  isCurrent: boolean;
}

function findOwningGroup(
  snapshot: CatalogSnapshot,
  domain: "material" | "skill",
  libraryId: string
):
  | {
      groupId: string;
      groupTitle: string;
      memberIds: string[];
    }
  | undefined {
  const groups =
    domain === "material" ? snapshot.materialGroups : snapshot.skillGroups;
  for (const group of groups) {
    const memberIds = [
      ...new Set(
        Object.values(group.members).filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      )
    ];
    if (!memberIds.includes(libraryId)) continue;
    return {
      groupId: group.id,
      groupTitle: group.title,
      memberIds
    };
  }
  return undefined;
}

function resolveReadableLibraries(
  snapshot: CatalogSnapshot,
  domain: "material" | "skill",
  current: CatalogLibrary
): {
  sources: ResolvedLibrarySource[];
  groupId?: string;
  groupTitle?: string;
  readableLibraries: LibraryAgentReadableLibrary[];
} {
  const currentKind =
    domain === "material"
      ? (current as MaterialLibrary).materialKind
      : (current as SkillLibrary).skillKind;
  const owningGroup = findOwningGroup(snapshot, domain, current.id);
  if (!owningGroup) {
    const readableLibraries = [
      {
        libraryId: current.id,
        title: current.title,
        kind: currentKind
      }
    ];
    return {
      sources: [{ library: current, kind: currentKind, isCurrent: true }],
      readableLibraries
    };
  }

  const libraries =
    domain === "material" ? snapshot.materials : snapshot.skills;
  const sources: ResolvedLibrarySource[] = [];
  const readableLibraries: LibraryAgentReadableLibrary[] = [];
  for (const memberId of owningGroup.memberIds) {
    const library =
      memberId === current.id
        ? current
        : libraries.find((candidate) => candidate.id === memberId);
    if (!library) continue;
    const kind =
      domain === "material"
        ? (library as MaterialLibrary).materialKind
        : (library as SkillLibrary).skillKind;
    sources.push({
      library,
      kind,
      isCurrent: library.id === current.id
    });
    readableLibraries.push({
      libraryId: library.id,
      title: library.title,
      kind
    });
  }

  // Keep the current library first for prioritization and prompts.
  sources.sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent));
  readableLibraries.sort((left, right) =>
    left.libraryId === current.id ? -1 : right.libraryId === current.id ? 1 : 0
  );

  return {
    sources,
    groupId: owningGroup.groupId,
    groupTitle: owningGroup.groupTitle,
    readableLibraries
  };
}

function resolveEntryContent(input: {
  domain: "material" | "skill";
  libraryId: string;
  entryId: string;
  entryTitle: string;
  entryBody: string;
  liveDocuments: readonly WorkspaceDocument[];
}): {
  documentId: string;
  title: string;
  content: string;
  readOnly: boolean;
} {
  const document = input.liveDocuments.find(
    (candidate) =>
      candidate.domain === input.domain &&
      candidate.libraryId === input.libraryId &&
      candidate.catalogEntryId === input.entryId
  );
  if (document) {
    return {
      documentId: document.id,
      title: document.title,
      content: document.content,
      readOnly: Boolean(document.readOnly)
    };
  }
  return {
    documentId: entryDocumentId(input.domain, input.libraryId, input.entryId),
    title: input.entryTitle,
    content: input.entryBody,
    readOnly: true
  };
}

export function buildLibraryAgentWorkspaceContext(
  snapshot: CatalogSnapshot | null,
  activeDocument: WorkspaceDocument,
  liveDocuments: readonly WorkspaceDocument[]
): LibraryAgentWorkspaceSnapshot | undefined {
  if (
    !snapshot ||
    !activeDocument.libraryId ||
    (activeDocument.domain !== "material" && activeDocument.domain !== "skill")
  ) {
    return undefined;
  }

  const domain = activeDocument.domain;
  const materialLibrary =
    domain === "material"
      ? snapshot.materials.find(({ id }) => id === activeDocument.libraryId)
      : undefined;
  const skillLibrary =
    domain === "skill"
      ? snapshot.skills.find(({ id }) => id === activeDocument.libraryId)
      : undefined;
  const library = materialLibrary ?? skillLibrary;
  if (!library) return undefined;

  const {
    sources,
    groupId,
    groupTitle,
    readableLibraries
  } = resolveReadableLibraries(snapshot, domain, library);

  const activeEntryId = activeDocument.catalogEntryId;
  const overviewSnapshot = takeSnapshotText(
    library.overview,
    LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
  );
  let remainingCharacters =
    LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS -
    overviewSnapshot.content.length;
  const entries: LibraryAgentEntrySnapshot[] = [];
  let totalCatalogEntries = 0;

  for (const source of sources) {
    totalCatalogEntries += source.library.entries.length;
    for (const entry of source.library.entries) {
      if (entries.length >= LIBRARY_AGENT_MAX_ENTRIES) break;
      // Always reserve room for the active entry from the current library.
      if (
        !source.isCurrent &&
        activeEntryId &&
        !entries.some((candidate) => candidate.id === activeEntryId) &&
        entries.length >= LIBRARY_AGENT_MAX_ENTRIES - 1
      ) {
        break;
      }

      const resolved = resolveEntryContent({
        domain,
        libraryId: source.library.id,
        entryId: entry.id,
        entryTitle: entry.title,
        entryBody: entry.body,
        liveDocuments
      });

      // Current-library active entry must come from a live document.
      if (
        source.isCurrent &&
        entry.id === activeEntryId &&
        !liveDocuments.some(
          (document) =>
            document.domain === domain &&
            document.libraryId === source.library.id &&
            document.catalogEntryId === entry.id
        )
      ) {
        continue;
      }

      const snapshotEntryId = source.isCurrent
        ? entry.id
        : peerEntrySnapshotId(source.library.id, entry.id);
      if (entries.some((candidate) => candidate.id === snapshotEntryId)) {
        continue;
      }

      const perEntryLimit =
        source.isCurrent && entry.id === activeEntryId
          ? LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
          : BACKGROUND_ENTRY_MAX_CHARACTERS;
      const textLimit = Math.min(perEntryLimit, remainingCharacters);
      if (textLimit <= 0) break;
      const textSnapshot = takeSnapshotText(resolved.content, textLimit);
      remainingCharacters -= textSnapshot.content.length;

      const peerMeta = source.isCurrent
        ? {}
        : {
            sourceLibraryId: source.library.id,
            sourceLibraryTitle: source.library.title
          };

      entries.push({
        id: snapshotEntryId,
        documentId: resolved.documentId,
        stageId: entry.stageId,
        title: resolved.title,
        content: textSnapshot.content,
        revision: createShortWorkspaceContentRevision(textSnapshot.content),
        readOnly:
          !source.isCurrent ||
          Boolean(skillLibrary?.isBuiltin) ||
          resolved.readOnly,
        ...peerMeta,
        ...(textSnapshot.truncated
          ? {
              truncated: true,
              originalLength: textSnapshot.originalLength
            }
          : {})
      } as LibraryAgentEntrySnapshot);
    }
  }

  // Ensure the active entry is present if it was deferred by capacity.
  if (
    activeEntryId &&
    !entries.some(({ id }) => id === activeEntryId)
  ) {
    const activeEntry = library.entries.find(({ id }) => id === activeEntryId);
    const liveActive = liveDocuments.find(
      (document) =>
        document.domain === domain &&
        document.libraryId === library.id &&
        document.catalogEntryId === activeEntryId
    );
    if (!activeEntry || !liveActive) return undefined;
    if (entries.length >= LIBRARY_AGENT_MAX_ENTRIES) {
      entries.pop();
    }
    const textLimit = Math.min(
      LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
      LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS - overviewSnapshot.content.length
    );
    const textSnapshot = takeSnapshotText(liveActive.content, textLimit);
    entries.unshift({
      id: activeEntry.id,
      documentId: liveActive.id,
      stageId: activeEntry.stageId,
      title: liveActive.title,
      content: textSnapshot.content,
      revision: createShortWorkspaceContentRevision(textSnapshot.content),
      readOnly: Boolean(skillLibrary?.isBuiltin) || Boolean(liveActive.readOnly),
      ...(textSnapshot.truncated
        ? {
            truncated: true,
            originalLength: textSnapshot.originalLength
          }
        : {})
    } as LibraryAgentEntrySnapshot);
  }

  if (activeEntryId && !entries.some(({ id }) => id === activeEntryId)) {
    return undefined;
  }

  const omittedEntryCount = Math.max(0, totalCatalogEntries - entries.length);
  const common = {
    libraryId: library.id,
    title: library.title,
    overview: overviewSnapshot.content,
    ...(overviewSnapshot.truncated
      ? {
          overviewTruncated: true as const,
          overviewOriginalLength: overviewSnapshot.originalLength
        }
      : {}),
    readOnly: skillLibrary?.isBuiltin ?? false,
    ...(activeEntryId ? { activeEntryId } : {}),
    ...(library.projectRevision === undefined
      ? {}
      : { projectRevision: library.projectRevision }),
    ...(omittedEntryCount > 0 ? { omittedEntryCount } : {}),
    ...(groupId && groupTitle ? { groupId, groupTitle } : {}),
    ...(readableLibraries.length > 1 ? { readableLibraries } : {})
  };

  return materialLibrary
    ? {
        ...common,
        domain: "material",
        libraryType: materialLibrary.materialType,
        kind: materialLibrary.materialKind,
        entries: entries as Extract<
          LibraryAgentWorkspaceSnapshot,
          { domain: "material" }
        >["entries"]
      }
    : {
        ...common,
        domain: "skill",
        libraryType: skillLibrary!.skillType,
        kind: skillLibrary!.skillKind,
        entries: entries.map((entry) => ({
          ...entry,
          readOnly: skillLibrary!.isBuiltin || entry.readOnly
        })) as Extract<
          LibraryAgentWorkspaceSnapshot,
          { domain: "skill" }
        >["entries"]
      };
}

export function buildLibraryEntryComposerReferences(
  context: LibraryAgentWorkspaceSnapshot | undefined
): ComposerReferenceOption[] {
  if (!context) return [];
  const domainLabel = context.domain === "skill" ? "技能" : "素材";
  const activeEntryId = context.activeEntryId;
  return context.entries
    .filter((entry) => entry.id !== activeEntryId)
    .map((entry) => {
      const isPeer =
        entry.sourceLibraryId !== undefined &&
        entry.sourceLibraryId !== context.libraryId;
      return {
        id: entry.documentId,
        label: entry.title,
        detail: isPeer
          ? `分组 · ${entry.sourceLibraryTitle ?? "同组成员库"}`
          : context.groupTitle
            ? `当前${domainLabel}库 · ${context.groupTitle}`
            : `当前${domainLabel}库`
      };
    });
}
