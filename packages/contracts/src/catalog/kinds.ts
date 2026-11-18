import { z } from "zod";

export const CatalogIdSchema = z.string().trim().min(1).max(512);
export const CatalogTitleSchema = z.string().trim().min(1).max(256);
export const TimestampSchema = z.string().datetime();

export const CATALOG_PROJECT_MANIFEST_FILENAME = "deepwrite.json" as const;
export const CATALOG_PROJECT_MAX_CONTENT_ITEMS = 4_096;
export const CATALOG_DRAFT_DIRECTORY_ID = "draft" as const;

export const CATALOG_PROJECT_DOMAINS = ["book", "material", "skill"] as const;
export const CatalogProjectDomainSchema = z.enum(CATALOG_PROJECT_DOMAINS);
export type CatalogProjectDomain = z.infer<typeof CatalogProjectDomainSchema>;

export const CatalogLibraryProjectDomainSchema = z.enum(["material", "skill"]);
export type CatalogLibraryProjectDomain = z.infer<
  typeof CatalogLibraryProjectDomainSchema
>;
/** Recommended length for library entries; save is not blocked above this. */
export const CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS = 40_000;
/** Recommended length for library overviews; save is not blocked above this. */
export const CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS = 40_000;

export const CATALOG_PROJECT_KINDS = [
  "deepwrite.book",
  "deepwrite.material-library",
  "deepwrite.skill-library",
  "deepwrite.material-group",
  "deepwrite.skill-group"
] as const;
export const CatalogProjectKindSchema = z.enum(CATALOG_PROJECT_KINDS);
export type CatalogProjectKind = z.infer<typeof CatalogProjectKindSchema>;

function isRelativeMarkdownPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    !value.endsWith(".md")
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    );
}

export const CatalogProjectContentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(isRelativeMarkdownPath, {
    message: "Catalog project content paths must be relative Markdown paths."
  });
export type CatalogProjectContentPath = z.infer<
  typeof CatalogProjectContentPathSchema
>;

export function uniqueIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const UniqueIdListSchema = z.array(CatalogIdSchema).refine(uniqueIds, {
  message: "Catalog id lists cannot contain duplicates."
});

export const SHORT_BOOK_GENRES = [
  "世情",
  "追妻",
  "科幻",
  "悬疑",
  "其他"
] as const;
export const ShortBookGenreSchema = z.enum(SHORT_BOOK_GENRES);
export type ShortBookGenre = z.infer<typeof ShortBookGenreSchema>;

/** Kept separate so script genres can evolve without changing short books. */
export const SCRIPT_BOOK_GENRES = [...SHORT_BOOK_GENRES] as const;
export const ScriptBookGenreSchema = z.enum(SCRIPT_BOOK_GENRES);
export type ScriptBookGenre = z.infer<typeof ScriptBookGenreSchema>;

export const MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const MaterialKindSchema = z.enum(MATERIAL_KINDS);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

export const MaterialLibraryKindSchema = z.enum([...MATERIAL_KINDS, "mixed"]);
export type MaterialLibraryKind = z.infer<typeof MaterialLibraryKindSchema>;

export const SKILL_KINDS = ["general", "plot", "style", "other"] as const;
export const SkillKindSchema = z.enum(SKILL_KINDS);
export type SkillKind = z.infer<typeof SkillKindSchema>;

export const LIBRARY_CUSTOM_TAG_MAX_LENGTH = 24;
export const LibraryCustomTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIBRARY_CUSTOM_TAG_MAX_LENGTH);
export type LibraryCustomTag = z.infer<typeof LibraryCustomTagSchema>;

export const MATERIAL_PRESET_TAGS = [
  "文献",
  "数据",
  "设定",
  "案例",
  "其他"
] as const;
export type MaterialPresetTag = (typeof MATERIAL_PRESET_TAGS)[number];

export const SKILL_PRESET_TAGS = ["通用", "论证", "规范", "其他"] as const;
export type SkillPresetTag = (typeof SKILL_PRESET_TAGS)[number];

export const MATERIAL_GROUP_LEGACY_SLOTS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const SKILL_GROUP_LEGACY_SLOTS = [
  "general",
  "plot",
  "style",
  "other"
] as const;

export const LibraryGroupMemberIdsSchema = UniqueIdListSchema;

export function extractLegacyGroupMemberIds(
  members: unknown,
  slotOrder: readonly string[] = MATERIAL_GROUP_LEGACY_SLOTS
): string[] {
  if (
    members === null ||
    typeof members !== "object" ||
    Array.isArray(members)
  ) {
    return [];
  }
  const record = members as Record<string, unknown>;
  const ordered: string[] = [];
  for (const slot of slotOrder) {
    const value = record[slot];
    if (typeof value === "string" && value.trim().length > 0) {
      ordered.push(value.trim());
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (
      !slotOrder.includes(key) &&
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      ordered.push(value.trim());
    }
  }
  return [...new Set(ordered)];
}

export function migrateLegacyGroupMembers(slotOrder: readonly string[]) {
  return (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.memberIds)) {
      if ("members" in record) {
        const { members: _members, ...rest } = record;
        return rest;
      }
      return value;
    }
    if (
      record.members !== null &&
      typeof record.members === "object" &&
      !Array.isArray(record.members) &&
      Object.values(record.members as Record<string, unknown>).every(
        (item) => item === undefined || typeof item === "string"
      )
    ) {
      const { members, ...rest } = record;
      return {
        ...rest,
        memberIds: extractLegacyGroupMemberIds(members, slotOrder)
      };
    }
    return value;
  };
}

export const LibraryTypeSchema = z.enum(["short", "long", "script"]);
export type LibraryType = z.infer<typeof LibraryTypeSchema>;

export const MATERIAL_STAGE_IDS = [
  "gimmick",
  "character",
  "pacing",
  "intro",
  "plot_refine",
  "draft_excerpt",
  "other"
] as const;
export const MaterialStageIdSchema = z.enum(MATERIAL_STAGE_IDS);
export type MaterialStageId = z.infer<typeof MaterialStageIdSchema>;

export const SKILL_STAGE_IDS = [
  "character_design",
  "plot_design",
  "outline",
  "draft",
  "expert_section_writer"
] as const;
export const SkillStageIdSchema = z.enum(SKILL_STAGE_IDS);
export type SkillStageId = z.infer<typeof SkillStageIdSchema>;

export const LinkedMaterialIdsByKindSchema = z.object({
  character: UniqueIdListSchema,
  gimmick: UniqueIdListSchema,
  plot: UniqueIdListSchema,
  draft: UniqueIdListSchema,
  other: UniqueIdListSchema
});
export type LinkedMaterialIdsByKind = z.infer<
  typeof LinkedMaterialIdsByKindSchema
>;

export const LinkedMaterialIdsByKindInputSchema = z.object({
  character: UniqueIdListSchema.optional(),
  gimmick: UniqueIdListSchema.optional(),
  plot: UniqueIdListSchema.optional(),
  draft: UniqueIdListSchema.optional(),
  other: UniqueIdListSchema.optional()
});
export type LinkedMaterialIdsByKindInput = z.infer<
  typeof LinkedMaterialIdsByKindInputSchema
>;

export const LinkedSkillIdsByKindSchema = z.object({
  general: UniqueIdListSchema,
  plot: UniqueIdListSchema,
  style: UniqueIdListSchema,
  other: UniqueIdListSchema
});
export type LinkedSkillIdsByKind = z.infer<typeof LinkedSkillIdsByKindSchema>;

export const LinkedSkillIdsByKindInputSchema = z.object({
  general: UniqueIdListSchema.optional(),
  plot: UniqueIdListSchema.optional(),
  style: UniqueIdListSchema.optional(),
  other: UniqueIdListSchema.optional()
});
export type LinkedSkillIdsByKindInput = z.infer<
  typeof LinkedSkillIdsByKindInputSchema
>;

export const CatalogDocumentSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>;
