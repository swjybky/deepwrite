import {
  createShortWorkspaceContentRevision,
  parseExpertDraftMarkdown,
  serializeExpertDraftMarkdown,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { draftCharacterStateTitle } from "./draftFileTitles";

export interface LegacyDraftRecoveryMigrationResult {
  drafts: Record<string, EditorDraftState>;
  migratedLegacyKeys: string[];
  unmappedLegacyKeys: string[];
}

export function legacyBookDraftRecoveryKey(bookId: string): string {
  return ["catalog", "book-document", encodeURIComponent(bookId), "draft"].join(":");
}

function newerDraft(
  existing: EditorDraftState | undefined,
  candidate: EditorDraftState
): EditorDraftState {
  if (!existing) return candidate;
  const existingTime = Date.parse(existing.recoveryUpdatedAt ?? "");
  const candidateTime = Date.parse(candidate.recoveryUpdatedAt ?? "");
  return Number.isFinite(candidateTime) &&
    (!Number.isFinite(existingTime) || candidateTime > existingTime)
    ? candidate
    : existing;
}

function recoveredPhysicalDraft(
  legacy: EditorDraftState,
  document: WorkspaceDocument,
  title: string,
  content: string,
  projectRevision: number | undefined
): EditorDraftState {
  return {
    title,
    content,
    dirty: true,
    ...(legacy.recoveryUpdatedAt
      ? { recoveryUpdatedAt: legacy.recoveryUpdatedAt }
      : {}),
    baseRevision: createShortWorkspaceContentRevision(document.content),
    ...(projectRevision === undefined
      ? {}
      : { baseProjectRevision: projectRevision })
  };
}

/**
 * Converts only the retired v1 combined-draft recovery key. Normal editor
 * drafts remain physical files and never pass through the legacy parser.
 */
export function migrateLegacyDraftRecoveries(
  drafts: Readonly<Record<string, EditorDraftState>>,
  snapshot: CatalogSnapshot,
  projection: CatalogWorkspaceProjection
): LegacyDraftRecoveryMigrationResult {
  const nextDrafts = { ...drafts };
  const migratedLegacyKeys: string[] = [];
  const unmappedLegacyKeys: string[] = [];
  const documentsById = new Map(
    projection.workspaceDocuments.map((document) => [document.id, document] as const)
  );

  for (const book of snapshot.books) {
    const legacyKey = legacyBookDraftRecoveryKey(book.id);
    const legacy = nextDrafts[legacyKey];
    if (!legacy?.dirty) continue;

    const directory = projection.draftDirectories.find(
      (candidate) => candidate.workspaceId === book.id
    );
    const recovered = parseExpertDraftMarkdown(legacy.content);
    const currentCombinedRevision = createShortWorkspaceContentRevision(
      serializeExpertDraftMarkdown({
        sections: book.draft.sections.map((section) => ({
          id: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          body: section.body.content,
          characterState: section.characterState.content
        }))
      })
    );
    // The retired recovery revision hashes the complete combined draft. Only
    // split it when the current v2 directory still represents that exact base.
    // Missing or stale bases remain under the legacy key so a recovered draft
    // can never be silently rebased onto newer physical files.
    const recoveryBaseMatches =
      legacy.baseRevision !== undefined &&
      legacy.baseRevision === currentCombinedRevision;
    const structureMatches =
      recoveryBaseMatches &&
      directory !== undefined &&
      recovered.sections.length === directory.sections.length &&
      recovered.sections.every((section, index) => {
        const projectedSection = directory.sections[index];
        return (
          projectedSection?.id === section.id &&
          projectedSection.wordCountRequirement === section.wordCountRequirement
        );
      });
    if (!directory || !structureMatches) {
      unmappedLegacyKeys.push(legacyKey);
      continue;
    }

    const mappedFiles = recovered.sections.map((section, index) => {
      const projectedSection = directory.sections[index]!;
      return {
        section,
        body: documentsById.get(projectedSection.bodyDocumentId),
        characterState: documentsById.get(
          projectedSection.characterStateDocumentId
        )
      };
    });
    if (mappedFiles.some(({ body, characterState }) => !body || !characterState)) {
      unmappedLegacyKeys.push(legacyKey);
      continue;
    }

    delete nextDrafts[legacyKey];
    for (const { section, body, characterState } of mappedFiles) {
      if (!body || !characterState) continue;
      if (section.title !== body.title || section.body !== body.content) {
        const candidate = recoveredPhysicalDraft(
          legacy,
          body,
          section.title,
          section.body,
          book.projectRevision
        );
        nextDrafts[body.id] = newerDraft(nextDrafts[body.id], candidate);
      }
      const stateTitle = draftCharacterStateTitle(section.title);
      if (
        stateTitle !== characterState.title ||
        section.characterState !== characterState.content
      ) {
        const candidate = recoveredPhysicalDraft(
          legacy,
          characterState,
          stateTitle,
          section.characterState,
          book.projectRevision
        );
        nextDrafts[characterState.id] = newerDraft(
          nextDrafts[characterState.id],
          candidate
        );
      }
    }
    migratedLegacyKeys.push(legacyKey);
  }

  return { drafts: nextDrafts, migratedLegacyKeys, unmappedLegacyKeys };
}
