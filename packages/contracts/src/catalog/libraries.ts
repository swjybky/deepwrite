import { z } from "zod";

import { MarketplaceSourceSchema } from "../marketplace";
import {
  CatalogIdSchema,
  CatalogTitleSchema,
  LibraryCustomTagSchema,
  LibraryGroupMemberIdsSchema,
  LibraryTypeSchema,
  MATERIAL_GROUP_LEGACY_SLOTS,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SKILL_GROUP_LEGACY_SLOTS,
  SkillKindSchema,
  SkillStageIdSchema,
  TimestampSchema,
  migrateLegacyGroupMembers
} from "./kinds";

export const MaterialEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: MaterialStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialEntry = z.infer<typeof MaterialEntrySchema>;

export const MaterialLibrarySchema = z.object({
  isUnbound: z.boolean().optional(),
  isBuiltin: z.boolean().optional(),
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  materialType: LibraryTypeSchema,
  materialKind: MaterialLibraryKindSchema,
  customTag: LibraryCustomTagSchema.optional(),
  parentGenre: z.string(),
  subGenre: z.string(),
  overview: z.string(),
  entries: z.array(MaterialEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialLibrary = z.infer<typeof MaterialLibrarySchema>;

export const MaterialLibraryGroupSchema = z.preprocess(
  migrateLegacyGroupMembers(MATERIAL_GROUP_LEGACY_SLOTS),
  z.object({
    isBuiltin: z.boolean().optional(),
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    memberIds: LibraryGroupMemberIdsSchema,
    projectRevision: z.number().int().nonnegative().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
);
export type MaterialLibraryGroup = z.infer<typeof MaterialLibraryGroupSchema>;

export const SkillEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: SkillStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  marketplaceSource: MarketplaceSourceSchema.optional(),
  sourceCommonSkillId: CatalogIdSchema.optional(),
  sourceSkillId: CatalogIdSchema.optional(),
  sourceSkillEntryId: CatalogIdSchema.optional()
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillLibrarySchema = z.object({
  isUnbound: z.boolean().optional(),
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  skillType: LibraryTypeSchema,
  skillKind: SkillKindSchema,
  customTag: LibraryCustomTagSchema.optional(),
  overview: z.string(),
  isBuiltin: z.boolean(),
  marketplaceSource: MarketplaceSourceSchema.optional(),
  entries: z.array(SkillEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

export const SkillLibraryGroupSchema = z.preprocess(
  migrateLegacyGroupMembers(SKILL_GROUP_LEGACY_SLOTS),
  z.object({
    isBuiltin: z.boolean().optional(),
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    memberIds: LibraryGroupMemberIdsSchema,
    marketplaceSource: MarketplaceSourceSchema.optional(),
    projectRevision: z.number().int().nonnegative().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
);
export type SkillLibraryGroup = z.infer<typeof SkillLibraryGroupSchema>;
