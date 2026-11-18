import { createScopedTranslator } from "../i18n";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  type Book,
  type CatalogIndexSnapshot,
  type MaterialKind,
  type SkillKind
} from "@deepwrite/contracts/renderer";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_KINDS,
  SKILL_KIND_LABELS
} from "../data/catalogWorkspace";
import type { ComposerReferenceOption } from "../types/conversation";

const t = createScopedTranslator("workspace.shortLibraryReferences");

function catalogDocumentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return ["catalog", `${domain}-entry`, libraryId, entryId]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function creationSkillReferences(
  snapshot: CatalogIndexSnapshot | null,
  book: Book | undefined,
  _allowedKinds?: readonly SkillKind[]
): ComposerReferenceOption[] {
  if (!snapshot || !book) return [];
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const seenLibraries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  const skillLibraryIdGroups =
    book.bookType === "academic"
      ? [book.linkedSkillIds]
      : Object.values(book.linkedSkillIdsByKind);
  for (const boundIds of skillLibraryIdGroups) {
    for (const libraryId of boundIds) {
      if (seenLibraries.has(libraryId)) continue;
      seenLibraries.add(libraryId);
      const library = libraries.get(libraryId);
      if (!library) continue;
      for (const entry of library.entries) {
        if (entry.contentBytes <= 0) continue;
        references.push({
          id: catalogDocumentId("skill", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: t("linkedToThisBook", {
            value: library.customTag ?? SKILL_KIND_LABELS[library.skillKind]
          })
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) return references;
      }
    }
  }
  return references;
}

export function creationMaterialReferences(
  snapshot: CatalogIndexSnapshot | null,
  book: Book | undefined,
  _allowedKinds?: readonly MaterialKind[]
): ComposerReferenceOption[] {
  if (!snapshot || !book) return [];
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const references: ComposerReferenceOption[] = [];
  const seenEntries = new Set<string>();
  const materialLibraryIdGroups =
    book.bookType === "academic"
      ? [book.linkedMaterialIds]
      : Object.values(book.linkedMaterialIdsByKind);
  for (const libraryIds of materialLibraryIdGroups) {
    for (const libraryId of libraryIds) {
      const library = libraries.get(libraryId);
      if (!library) continue;
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        const entryKey = `${library.id}\u0000${entry.id}`;
        if (entry.contentBytes <= 0 || seenEntries.has(entryKey)) {
          continue;
        }
        seenEntries.add(entryKey);
        references.push({
          id: catalogDocumentId("material", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: t("linkedToThisBook", {
            value: library.customTag ?? MATERIAL_KIND_LABELS[entryKind]
          })
        });
      }
    }
  }
  return references;
}
