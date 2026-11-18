import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  type Book,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind,
  type ShortAgentReadAccess
} from "@deepwrite/contracts";

export function scopeBookLibrariesToReadAccess(
  book: Book,
  readAccess: ShortAgentReadAccess
): Book {
  if (book.bookType === "academic") {
    return book;
  }
  const allowedMaterials = new Set(readAccess.material);
  const allowedSkills = new Set(readAccess.skill);
  const linkedMaterialIdsByKind = Object.fromEntries(
    MATERIAL_KINDS.map((kind) => [
      kind,
      allowedMaterials.has(kind) ? [...book.linkedMaterialIdsByKind[kind]] : []
    ])
  ) as LinkedMaterialIdsByKind;
  const linkedSkillIdsByKind = Object.fromEntries(
    SKILL_KINDS.map((kind) => [
      kind,
      allowedSkills.has(kind) ? [...book.linkedSkillIdsByKind[kind]] : []
    ])
  ) as LinkedSkillIdsByKind;
  return { ...book, linkedMaterialIdsByKind, linkedSkillIdsByKind };
}
