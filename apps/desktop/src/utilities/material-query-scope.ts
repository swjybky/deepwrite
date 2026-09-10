import {
  MATERIAL_KINDS,
  materialPreview,
  MATERIAL_STAGE_KINDS,
  LongWorkspaceRootSchema,
  longLinkedResourceIsEnabledForStage,
  type CatalogIndexSnapshot,
  type LongBookSummary,
  type MaterialReadScope,
  type MaterialKind
} from "@deepwrite/contracts";

export interface MaterialCandidate {
  id: string;
  libraryId: string;
  entryId: string;
  title: string;
  entryTitle: string;
  kind: MaterialKind;
  stamp: string;
}

/** Re-evaluated against persisted bindings for every query, including reads. */
export function scopedMaterialCandidates(
  index: CatalogIndexSnapshot,
  scope: MaterialReadScope,
  longBook?: LongBookSummary,
  notices: string[] = []
): MaterialCandidate[] {
  const book =
    scope.bookType === "long"
      ? longBook
      : index.books.find(
          (item) => item.id === scope.bookId && item.bookType === scope.bookType
        );
  if (!book || book.id !== scope.bookId)
    throw new Error("关联素材所属书籍不存在或已不可读。");
  const candidates: MaterialCandidate[] = [];
  const used = new Set<string>();
  for (const kind of MATERIAL_KINDS) {
    if (!scope.kinds.includes(kind)) continue;
    for (const libraryId of new Set(book.linkedMaterialIdsByKind[kind])) {
      if (
        longBook &&
        !longLinkedResourceIsEnabledForStage(
          longBook.linkedResourceStageScopes,
          "material",
          libraryId,
          LongWorkspaceRootSchema.parse(scope.stageId)
        )
      )
        continue;
      const library = index.materials.find((item) => item.id === libraryId);
      if (
        !library ||
        (library.materialKind !== "mixed" && library.materialKind !== kind)
      ) {
        if (notices.length < 20)
          notices.push(
            `关联素材库「${materialPreview(library?.title ?? libraryId, 240)}」不存在或分类已变化，请检查关联。`
          );
        continue;
      }
      for (const entry of library.entries) {
        if (
          MATERIAL_STAGE_KINDS[entry.stageId] !== kind ||
          entry.contentBytes === 0
        )
          continue;
        const base = `material:${libraryId}:${entry.id}`;
        let id = base;
        for (let suffix = 2; used.has(id); suffix++) id = `${base}:${suffix}`;
        used.add(id);
        const combined = `${library.title} · ${entry.title}`;
        const suffix = ` · ${entry.id.slice(-12)}`;
        candidates.push({
          id,
          libraryId,
          entryId: entry.id,
          title:
            combined.length <= 240
              ? combined
              : `${combined.slice(0, 240 - suffix.length)}${suffix}`,
          entryTitle: entry.title,
          kind,
          stamp: entry.contentStamp
        });
      }
    }
  }
  return candidates;
}
