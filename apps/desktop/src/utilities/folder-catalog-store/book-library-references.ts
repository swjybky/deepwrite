import type { CatalogSnapshot, UpdateBookInput } from "@deepwrite/contracts";

/** Validate the binding domains explicitly supplied by a creation or update. */
export function assertBookLibraryReferences(
  book: Pick<
    UpdateBookInput,
    "linkedMaterialIdsByKind" | "linkedSkillIdsByKind"
  > & { title: string },
  snapshot: Pick<CatalogSnapshot, "materials" | "skills">
): void {
  const materials = new Map(
    snapshot.materials
      .filter((item) => !item.isUnbound)
      .map((material) => [material.id, material])
  );
  const skills = new Map(
    snapshot.skills
      .filter((item) => !item.isUnbound)
      .map((skill) => [skill.id, skill])
  );
  for (const materialIds of Object.values(book.linkedMaterialIdsByKind ?? {})) {
    for (const materialId of materialIds ?? []) {
      if (!materials.has(materialId)) {
        throw new Error(
          `书籍「${book.title}」关联了不存在的素材库：${materialId}`
        );
      }
    }
  }
  for (const skillIds of Object.values(book.linkedSkillIdsByKind ?? {})) {
    for (const skillId of skillIds ?? []) {
      if (!skills.has(skillId)) {
        throw new Error(
          `书籍「${book.title}」绑定了不存在的技能库：${skillId}`
        );
      }
    }
  }
}

export function assertAcademicBookLibraryReferences(
  book: {
    title: string;
    linkedMaterialIds?: readonly string[] | undefined;
    linkedSkillIds?: readonly string[] | undefined;
  },
  snapshot: Pick<CatalogSnapshot, "materials" | "skills">
): void {
  const materials = new Map(
    snapshot.materials
      .filter((item) => !item.isUnbound)
      .map((material) => [material.id, material])
  );
  const skills = new Map(
    snapshot.skills
      .filter((item) => !item.isUnbound)
      .map((skill) => [skill.id, skill])
  );
  for (const materialId of book.linkedMaterialIds ?? []) {
    if (!materials.has(materialId)) {
      throw new Error(
        `学术作品「${book.title}」关联了不存在的素材库：${materialId}`
      );
    }
  }
  for (const skillId of book.linkedSkillIds ?? []) {
    if (!skills.has(skillId)) {
      throw new Error(
        `学术作品「${book.title}」绑定了不存在的技能库：${skillId}`
      );
    }
  }
}
