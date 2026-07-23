import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LIBRARY_AGENT_MAX_ENTRIES,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS,
  LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS,
  createShortWorkspaceContentRevision,
  type CatalogSnapshot,
  type LibraryAgentEntrySnapshot,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";

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

function selectedEntryIds(
  entryIds: readonly string[],
  activeEntryId?: string
): Set<string> {
  const selected = entryIds.slice(0, LIBRARY_AGENT_MAX_ENTRIES);
  if (
    activeEntryId &&
    entryIds.includes(activeEntryId) &&
    !selected.includes(activeEntryId)
  ) {
    selected[selected.length - 1] = activeEntryId;
  }
  return new Set(selected);
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

  const documentsByEntryId = new Map(
    liveDocuments.flatMap((document) =>
      document.domain === domain &&
      document.libraryId === library.id &&
      document.catalogEntryId
        ? [[document.catalogEntryId, document] as const]
        : []
    )
  );
  const activeEntryId = activeDocument.catalogEntryId;
  const includedIds = selectedEntryIds(
    library.entries.map(({ id }) => id),
    activeEntryId
  );
  const overviewSnapshot = takeSnapshotText(
    library.overview,
    LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
  );
  let remainingCharacters =
    LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS -
    overviewSnapshot.content.length;
  const entries: LibraryAgentEntrySnapshot[] = [];

  for (const entry of library.entries) {
    if (!includedIds.has(entry.id)) continue;
    const document = documentsByEntryId.get(entry.id);
    if (!document) continue;
    const perEntryLimit =
      entry.id === activeEntryId
        ? LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
        : BACKGROUND_ENTRY_MAX_CHARACTERS;
    const textLimit = Math.min(perEntryLimit, remainingCharacters);
    const textSnapshot = takeSnapshotText(document.content, textLimit);
    remainingCharacters -= textSnapshot.content.length;
    entries.push({
      id: entry.id,
      documentId: document.id,
      stageId: entry.stageId,
      title: document.title,
      content: textSnapshot.content,
      revision: createShortWorkspaceContentRevision(textSnapshot.content),
      readOnly: Boolean(document.readOnly),
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
    ...(library.entries.length > entries.length
      ? { omittedEntryCount: library.entries.length - entries.length }
      : {})
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
        entries: entries.map((entry) => ({ ...entry, readOnly: skillLibrary!.isBuiltin || entry.readOnly })) as Extract<
          LibraryAgentWorkspaceSnapshot,
          { domain: "skill" }
        >["entries"]
      };
}
