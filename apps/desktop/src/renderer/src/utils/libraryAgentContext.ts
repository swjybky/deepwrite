import { createScopedTranslator } from "../i18n";
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

const t = createScopedTranslator("workspace");

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
  return ["catalog", ...parts.map((part) => encodeURIComponent(part))].join(
    ":"
  );
}

function entryDocumentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return catalogNodeId(`${domain}-entry`, libraryId, entryId);
}

function overviewDocumentId(
  domain: "material" | "skill",
  libraryId: string
): string {
  return catalogNodeId(`${domain}-overview`, libraryId);
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
          (value): value is string =>
            typeof value === "string" && value.length > 0
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
  const owningGroup = findOwningGroup(snapshot, domain, current.id);
  const libraries =
    domain === "material" ? snapshot.materials : snapshot.skills;
  const ordered = [
    current,
    ...libraries.filter((library) => library.id !== current.id)
  ];
  const sources = ordered.map((library) => ({
    library,
    isCurrent: library.id === current.id,
    kind: "materialKind" in library ? library.materialKind : library.skillKind
  }));
  return {
    sources: sources.filter(
      (source) =>
        source.isCurrent || owningGroup?.memberIds.includes(source.library.id)
    ),
    ...(owningGroup
      ? { groupId: owningGroup.groupId, groupTitle: owningGroup.groupTitle }
      : {}),
    readableLibraries: sources.map(({ library, kind }) => ({
      libraryId: library.id,
      title: library.title,
      kind,
      readOnly: "isBuiltin" in library && library.isBuiltin,
      entryCount: library.entries.length,
      groupTitle: findOwningGroup(snapshot, domain, library.id)?.groupTitle
    }))
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
    readOnly: false
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

  const { sources, groupId, groupTitle, readableLibraries } =
    resolveReadableLibraries(snapshot, domain, library);

  const activeEntryId = activeDocument.catalogEntryId;
  const liveOverview = liveDocuments.find(
    (document) =>
      document.domain === domain &&
      document.libraryId === library.id &&
      document.catalogLibraryField === "overview"
  );
  const overviewContent = liveOverview?.content ?? library.overview;
  const overviewSnapshot = takeSnapshotText(
    overviewContent,
    LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
  );
  let remainingCharacters =
    LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS -
    overviewSnapshot.content.length;
  const entries: LibraryAgentEntrySnapshot[] = [];
  let totalCatalogEntries = 0;

  for (const source of sources) {
    totalCatalogEntries += source.library.entries.length;
    const prioritizedEntries = [...source.library.entries].sort(
      (left, right) =>
        Number(source.isCurrent && right.id === activeEntryId) -
        Number(source.isCurrent && left.id === activeEntryId)
    );
    for (const entry of prioritizedEntries) {
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

      const perEntryLimit = LIBRARY_AGENT_ENTRY_MAX_CHARACTERS;
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
        revision: createShortWorkspaceContentRevision(resolved.content),
        readOnly:
          ("isBuiltin" in source.library && source.library.isBuiltin) ||
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
  if (activeEntryId && !entries.some(({ id }) => id === activeEntryId)) {
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
      LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS -
        overviewSnapshot.content.length
    );
    const textSnapshot = takeSnapshotText(liveActive.content, textLimit);
    entries.unshift({
      id: activeEntry.id,
      documentId: liveActive.id,
      stageId: activeEntry.stageId,
      title: liveActive.title,
      content: textSnapshot.content,
      revision: createShortWorkspaceContentRevision(liveActive.content),
      readOnly:
        Boolean(skillLibrary?.isBuiltin) || Boolean(liveActive.readOnly),
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
    libraryGroups: (domain === "material"
      ? snapshot.materialGroups
      : snapshot.skillGroups
    ).map((group) => ({
      id: group.id,
      title: group.title,
      members: Object.fromEntries(
        Object.entries(group.members).filter((entry) => entry[1] !== undefined)
      ) as Record<string, string>
    })),
    libraryId: library.id,
    title: library.title,
    overviewDocumentId:
      liveOverview?.id ?? overviewDocumentId(domain, library.id),
    overview: overviewSnapshot.content,
    overviewRevision: createShortWorkspaceContentRevision(overviewContent),
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
    readableLibraries
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
        entries: entries as Extract<
          LibraryAgentWorkspaceSnapshot,
          { domain: "skill" }
        >["entries"]
      };
}

export function buildLibraryEntryComposerReferences(
  context: LibraryAgentWorkspaceSnapshot | undefined
): ComposerReferenceOption[] {
  if (!context) return [];
  const domainLabel =
    context.domain === "skill"
      ? t("catalogWorkspace.skill")
      : t("catalogWorkspace.material");
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
          ? t("libraryAgentContext.group", {
              value:
                entry.sourceLibraryTitle ??
                t("libraryAgentContext.librariesInThisGroup")
            })
          : context.groupTitle
            ? t("libraryAgentContext.currentLibrary", {
                domainLabel: domainLabel,
                groupTitle: context.groupTitle
              })
            : t("libraryAgentContext.currentLibrary2", {
                domainLabel: domainLabel
              })
      };
    });
}
