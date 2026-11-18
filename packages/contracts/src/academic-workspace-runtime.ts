import { z } from "zod";
import {
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  ACADEMIC_MAX_CHAPTERS,
  ACADEMIC_MAX_REFERENCE_CARDS,
  ACADEMIC_MAX_SECTIONS,
  AcademicBookSubtypeSchema,
  AcademicCiteKeySchema,
  AcademicReferenceCardTypeSchema,
  AcademicSectionFileKindSchema
} from "./academic-book";
import { AcademicCitationStyleSchema } from "./academic-citation-style";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "./expert-draft";
import { WRITING_CONTEXT_MAX_CHARACTERS } from "./writing-context";

export const PROVISIONAL_ACADEMIC_CARD_ID_PREFIX = "pending:academic-card:";
export const PROVISIONAL_ACADEMIC_STAGE_ID_PREFIX = "pending:academic-stage:";
export const PROVISIONAL_ACADEMIC_CHAPTER_ID_PREFIX =
  "pending:academic-chapter:";
export const PROVISIONAL_ACADEMIC_SECTION_ID_PREFIX =
  "pending:academic-section:";

export const ACADEMIC_BATCH_CREATE_MAX_ITEMS = 50;
export const ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH = 256;
export const ACADEMIC_CHAPTER_TITLE_MAX_LENGTH = 256;
export const ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH = 120;
export const ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH = 20_000;
export const ACADEMIC_SECTION_TITLE_MAX_LENGTH = 240;
export const ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH = 1_000;

export function isProvisionalAcademicCardId(id: string): boolean {
  return id.startsWith(PROVISIONAL_ACADEMIC_CARD_ID_PREFIX);
}

export function isProvisionalAcademicStageId(id: string): boolean {
  return id.startsWith(PROVISIONAL_ACADEMIC_STAGE_ID_PREFIX);
}

export function isProvisionalAcademicChapterId(id: string): boolean {
  return id.startsWith(PROVISIONAL_ACADEMIC_CHAPTER_ID_PREFIX);
}

export function isProvisionalAcademicSectionId(id: string): boolean {
  return id.startsWith(PROVISIONAL_ACADEMIC_SECTION_ID_PREFIX);
}

export const AcademicRuntimeDocumentMetricsSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(256),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    characters: z.number().int().nonnegative(),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional()
  })
  .strict();
export type AcademicRuntimeDocumentMetrics = z.infer<
  typeof AcademicRuntimeDocumentMetricsSchema
>;

export const AcademicRuntimeReferenceCardSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH),
    documentId: z.string().trim().min(1).max(240),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    characters: z.number().int().nonnegative(),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional()
  })
  .strict();
export type AcademicRuntimeReferenceCardSummary = z.infer<
  typeof AcademicRuntimeReferenceCardSummarySchema
>;

export const AcademicRuntimeFrameworkStageSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    title: z
      .string()
      .trim()
      .min(1)
      .max(ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH),
    description: z
      .string()
      .trim()
      .min(1)
      .max(ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH),
    enabled: z.boolean(),
    builtin: z.boolean().optional(),
    document: AcademicRuntimeDocumentMetricsSchema
  })
  .strict();
export type AcademicRuntimeFrameworkStageSummary = z.infer<
  typeof AcademicRuntimeFrameworkStageSummarySchema
>;

export const AcademicRuntimeChapterSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(ACADEMIC_CHAPTER_TITLE_MAX_LENGTH),
    order: z.number().int().positive()
  })
  .strict();
export type AcademicRuntimeChapterSummary = z.infer<
  typeof AcademicRuntimeChapterSummarySchema
>;

export const AcademicRuntimeSectionSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    chapterId: z.string().trim().min(1).max(160).optional(),
    title: z.string().trim().min(1).max(ACADEMIC_SECTION_TITLE_MAX_LENGTH),
    wordCountRequirement: z
      .string()
      .max(ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH)
      .default(""),
    order: z.number().int().positive(),
    brief: AcademicRuntimeDocumentMetricsSchema,
    body: AcademicRuntimeDocumentMetricsSchema,
    state: AcademicRuntimeDocumentMetricsSchema
  })
  .strict();
export type AcademicRuntimeSectionSummary = z.infer<
  typeof AcademicRuntimeSectionSummarySchema
>;

export const AcademicActiveTargetSchema = z
  .object({
    zone: z.enum(["foundation", "framework", "manuscript"]),
    kind: z.enum([
      "thesis_overview",
      "terminology",
      "reference_card",
      "framework_stage",
      "section"
    ]),
    targetId: z.string().trim().min(1).max(160),
    sectionDocument: AcademicSectionFileKindSchema.optional(),
    title: z.string().trim().max(256).optional()
  })
  .strict();
export type AcademicActiveTarget = z.infer<typeof AcademicActiveTargetSchema>;

export const AcademicWorkspaceRuntimeContextSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(256),
    subtype: AcademicBookSubtypeSchema,
    citationStyle: AcademicCitationStyleSchema,
    agentsMd: z.string().max(WRITING_CONTEXT_MAX_CHARACTERS).optional(),
    readSource: z.enum(["inline", "core"]).optional(),
    projectRevision: z.number().int().nonnegative().optional(),
    foundation: z
      .object({
        thesisOverview: AcademicRuntimeDocumentMetricsSchema,
        terminology: AcademicRuntimeDocumentMetricsSchema,
        cards: z
          .array(AcademicRuntimeReferenceCardSummarySchema)
          .max(ACADEMIC_MAX_REFERENCE_CARDS)
      })
      .strict(),
    frameworkStages: z
      .array(AcademicRuntimeFrameworkStageSummarySchema)
      .min(1)
      .max(ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT),
    manuscript: z
      .object({
        chapters: z
          .array(AcademicRuntimeChapterSummarySchema)
          .max(ACADEMIC_MAX_CHAPTERS),
        sections: z
          .array(AcademicRuntimeSectionSummarySchema)
          .min(1)
          .max(ACADEMIC_MAX_SECTIONS)
      })
      .strict(),
    activeTarget: AcademicActiveTargetSchema.optional()
  })
  .strict();
export type AcademicWorkspaceRuntimeContext = z.infer<
  typeof AcademicWorkspaceRuntimeContextSchema
>;
