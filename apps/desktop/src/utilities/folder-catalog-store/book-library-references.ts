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
    snapshot.materials.map((material) => [material.id, material])
  );
  const skills = new Map(snapshot.skills.map((skill) => [skill.id, skill]));
  for (const [kind, materialIds] of Object.entries(
    book.linkedMaterialIdsByKind ?? {}
  )) {
    for (const materialId of materialIds ?? []) {
      const material = materials.get(materialId);
      if (!material) {
        throw new Error(
          `书籍「${book.title}」关联了不存在的素材库：${materialId}`
        );
      }
      if (material.materialKind !== "mixed" && material.materialKind !== kind) {
        throw new Error(`素材库「${material.title}」不能关联到 ${kind} 分类。`);
      }
    }
  }
  for (const [kind, skillIds] of Object.entries(
    book.linkedSkillIdsByKind ?? {}
  )) {
    for (const skillId of skillIds ?? []) {
      const skill = skills.get(skillId);
      if (!skill) {
        throw new Error(
          `书籍「${book.title}」绑定了不存在的技能库：${skillId}`
        );
      }
      if (skill.skillKind !== kind) {
        throw new Error(`技能库「${skill.title}」不能绑定到 ${kind} 分类。`);
      }
    }
  }
}
