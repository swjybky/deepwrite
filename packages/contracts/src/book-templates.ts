import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  AcademicBookSubtypeSchema,
  AcademicCitationStyleSchema,
  AcademicFrameworkStageIdSchema,
  BookCharacterFormatSchema,
  CreativePlotStageIdSchema,
  CREATIVE_PLOT_STAGE_MAX_COUNT
} from "./catalog";
import {
  ShortBookGenreSchema,
  ScriptBookGenreSchema,
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema
} from "./catalog";
import type { Book } from "./catalog";
import { LinkedAgentTeamIdsSchema } from "./agent-team-book-binding";

const CatalogIdSchema = z.string().trim().min(1).max(512);
const CatalogTitleSchema = z.string().trim().min(1).max(256);
const shape = {
  name: CatalogTitleSchema,
  characterFormat: BookCharacterFormatSchema,
  defaultPlotStageIds: z
    .array(CreativePlotStageIdSchema)
    .min(1)
    .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
    .refine((ids) => new Set(ids).size === ids.length, "剧情阶段不能重复"),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  /** Absent when the template leaves the team choice to the default. */
  linkedAgentTeamIds: LinkedAgentTeamIdsSchema.min(1).optional()
};
const UniqueTemplateIdListSchema = z
  .array(CatalogIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, "资料库 ID 不能重复");

export const AcademicBookTemplateDraftSchema = z
  .object({
    name: CatalogTitleSchema,
    workspaceType: z.literal("academic"),
    subtype: AcademicBookSubtypeSchema,
    citationStyle: AcademicCitationStyleSchema,
    defaultFrameworkStageIds: z
      .array(AcademicFrameworkStageIdSchema)
      .min(1)
      .max(ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "论证框架阶段不能重复"
      ),
    linkedMaterialIds: UniqueTemplateIdListSchema,
    linkedSkillIds: UniqueTemplateIdListSchema,
    linkedAgentTeamIds: LinkedAgentTeamIdsSchema.min(1).optional()
  })
  .strict();
export type AcademicBookTemplateDraft = z.infer<
  typeof AcademicBookTemplateDraftSchema
>;

export const ShortBookTemplateDraftSchema = z
  .object({
    ...shape,
    workspaceType: z.literal("short"),
    genre: ShortBookGenreSchema
  })
  .strict();
export type ShortBookTemplateDraft = z.infer<
  typeof ShortBookTemplateDraftSchema
>;

export const ScriptBookTemplateDraftSchema = z
  .object({
    ...shape,
    workspaceType: z.literal("script"),
    genre: ScriptBookGenreSchema
  })
  .strict();
export type ScriptBookTemplateDraft = z.infer<
  typeof ScriptBookTemplateDraftSchema
>;

export const BookTemplateDraftSchema = z.discriminatedUnion("workspaceType", [
  ShortBookTemplateDraftSchema,
  ScriptBookTemplateDraftSchema,
  AcademicBookTemplateDraftSchema
]);
export const BookTemplateSchema = z
  .object({ id: CatalogIdSchema, configuration: BookTemplateDraftSchema })
  .strict();
export const BookTemplateListSchema = z.array(BookTemplateSchema);
export const BookTemplateDiskSchema = z.object({
  version: z.literal(1),
  templates: BookTemplateListSchema
});
export const SaveBookTemplateInputSchema = z
  .object({
    id: CatalogIdSchema.optional(),
    configuration: BookTemplateDraftSchema
  })
  .strict();
export const BookTemplateTargetSchema = z
  .object({ id: CatalogIdSchema })
  .strict();
export const CreateBookFromTemplateInputSchema = z
  .object({ templateId: CatalogIdSchema, title: CatalogTitleSchema })
  .strict();
export const BookTemplateDeletedSchema = z.object({ deleted: z.literal(true) });
export type BookTemplate = z.infer<typeof BookTemplateSchema>;
export type BookTemplateDraft = z.infer<typeof BookTemplateDraftSchema>;
export type SaveBookTemplateInput = z.infer<typeof SaveBookTemplateInputSchema>;
export type CreateBookFromTemplateInput = z.infer<
  typeof CreateBookFromTemplateInputSchema
>;
export interface BookTemplatesApi {
  list(): Promise<BookTemplate[]>;
  save(input: SaveBookTemplateInput): Promise<BookTemplate>;
  delete(input: { id: string }): Promise<void>;
}
export type CreateBookFromTemplate = (
  input: CreateBookFromTemplateInput
) => Promise<Book | null>;
export const BookTemplateCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("bookTemplates.list"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("bookTemplates.save"),
    payload: SaveBookTemplateInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("bookTemplates.delete"),
    payload: BookTemplateTargetSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createBookFromTemplate"),
    payload: CreateBookFromTemplateInputSchema
  })
] as const;
