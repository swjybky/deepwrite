import { createScopedTranslator } from "../../i18n";
import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  resolveMaterialMetadata,
  isOnDemandMaterial,
  type CatalogSnapshot,
  type MaterialKind,
  type SkillKind
} from "@deepwrite/contracts/renderer";
import { MATERIAL_STAGE_KINDS } from "../../data/catalogWorkspace";
import {
  attachmentTitle,
  uniqueAttachmentId,
  type AttachmentCandidate,
  type LibraryAttachmentBindingTarget,
  type LibraryAttachmentDiagnostic
} from "./shared";

const t = createScopedTranslator("workspace.candidates");

export function collectMaterialCandidates(
  snapshot: CatalogSnapshot,
  book: LibraryAttachmentBindingTarget,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<MaterialKind>[] {
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const candidates: AttachmentCandidate<MaterialKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenLibraries = new Set<string>();

  const entriesToVisit: Array<{
    libraryId: string;
    expectedKind?: MaterialKind;
  }> =
    book.bookType === "academic"
      ? book.linkedMaterialIds.map((libraryId) => ({ libraryId }))
      : MATERIAL_KINDS.flatMap((selectedKind) =>
          book.linkedMaterialIdsByKind[selectedKind].map((libraryId) => ({
            libraryId,
            expectedKind: selectedKind
          }))
        );

  for (const { libraryId, expectedKind } of entriesToVisit) {
    if (seenLibraries.has(libraryId)) continue;
    seenLibraries.add(libraryId);
    const library = libraries.get(libraryId);
    if (!library) {
      diagnostics.push({
        code: "library-not-found",
        domain: "material",
        message: t("linkedMaterialLibraryDoesNotExist", {
          libraryId: libraryId
        }),
        bookId: book.id,
        libraryId,
        ...(expectedKind ? { expectedKind } : {})
      });
      continue;
    }
    for (const entry of library.entries) {
      if (!entry.body.trim() || isOnDemandMaterial(entry.body)) {
        continue;
      }
      const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
      const baseId = `material:${library.id}:${entry.id}`;
      candidates.push({
        domain: "material",
        libraryId: library.id,
        entryId: entry.id,
        attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
        title: attachmentTitle(library.title, entry.title, entry.id),
        content: entry.body,
        metadata: resolveMaterialMetadata({
          id: entry.id,
          title: entry.title,
          content: entry.body
        }),
        kind: entryKind
      });
    }
  }
  return candidates;
}

export function collectSkillCandidates(
  snapshot: CatalogSnapshot,
  book: LibraryAttachmentBindingTarget,
  diagnostics: LibraryAttachmentDiagnostic[]
): AttachmentCandidate<SkillKind>[] {
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const candidates: AttachmentCandidate<SkillKind>[] = [];
  const usedAttachmentIds = new Set<string>();
  const seenLibraries = new Set<string>();

  const entriesToVisit: Array<{
    libraryId: string;
    expectedKind?: SkillKind;
  }> =
    book.bookType === "academic"
      ? book.linkedSkillIds.map((libraryId) => ({ libraryId }))
      : SKILL_KINDS.flatMap((selectedKind) =>
          book.linkedSkillIdsByKind[selectedKind].map((libraryId) => ({
            libraryId,
            expectedKind: selectedKind
          }))
        );

  for (const { libraryId, expectedKind } of entriesToVisit) {
    if (seenLibraries.has(libraryId)) continue;
    seenLibraries.add(libraryId);
    const library = libraries.get(libraryId);
    if (!library) {
      diagnostics.push({
        code: "library-not-found",
        domain: "skill",
        message: t("linkedSkillLibraryDoesNotExist", {
          libraryId: libraryId
        }),
        bookId: book.id,
        libraryId,
        ...(expectedKind ? { expectedKind } : {})
      });
      continue;
    }
    for (const entry of library.entries) {
      if (!entry.body.trim()) {
        continue;
      }
      const baseId = `skill:${library.id}:${entry.id}`;
      candidates.push({
        domain: "skill",
        libraryId: library.id,
        entryId: entry.id,
        attachmentId: uniqueAttachmentId(baseId, usedAttachmentIds),
        title: attachmentTitle(library.title, entry.title, entry.id),
        content: entry.body,
        kind: library.skillKind
      });
    }
  }
  return candidates;
}
