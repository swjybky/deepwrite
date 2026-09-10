import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  resolveMaterialMetadata,
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
  const seenBindings = new Set<string>();

  for (const selectedKind of MATERIAL_KINDS) {
    for (const libraryId of book.linkedMaterialIdsByKind[selectedKind]) {
      const bindingKey = `${selectedKind}:${libraryId}`;
      if (seenBindings.has(bindingKey)) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "material",
          message: `素材库“${libraryId}”在 ${selectedKind} 分类下重复绑定，已只读取一次。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      seenBindings.add(bindingKey);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "material",
          message: `绑定的素材库“${libraryId}”不存在。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (
        library.materialKind !== "mixed" &&
        library.materialKind !== selectedKind
      ) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "material",
          message: `素材库“${library.title}”的用途为 ${library.materialKind}，但书籍将其绑定在 ${selectedKind}。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.materialKind
        });
      }
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        if (entryKind !== selectedKind || !entry.body.trim()) {
          continue;
        }
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
  const seenLibraryKinds = new Map<string, SkillKind>();

  for (const selectedKind of SKILL_KINDS) {
    for (const libraryId of book.linkedSkillIdsByKind[selectedKind]) {
      const previousKind = seenLibraryKinds.get(libraryId);
      if (previousKind) {
        diagnostics.push({
          code: "duplicate-library-binding",
          domain: "skill",
          message: `技能库“${libraryId}”同时绑定在 ${previousKind} 与 ${selectedKind}，已按 ${previousKind} 读取一次。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: previousKind
        });
        continue;
      }
      seenLibraryKinds.set(libraryId, selectedKind);
      const library = libraries.get(libraryId);
      if (!library) {
        diagnostics.push({
          code: "library-not-found",
          domain: "skill",
          message: `绑定的技能库“${libraryId}”不存在。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind
        });
        continue;
      }
      if (library.skillKind !== selectedKind) {
        diagnostics.push({
          code: "library-kind-mismatch",
          domain: "skill",
          message: `技能库“${library.title}”的分类为 ${library.skillKind}，但书籍将其绑定在 ${selectedKind}。`,
          bookId: book.id,
          libraryId,
          expectedKind: selectedKind,
          actualKind: library.skillKind
        });
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
  }
  return candidates;
}
