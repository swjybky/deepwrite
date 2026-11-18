import { z } from "zod";
import {
  ACADEMIC_BATCH_CREATE_MAX_ITEMS,
  ACADEMIC_CHAPTER_TITLE_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH,
  ACADEMIC_SECTION_TITLE_MAX_LENGTH,
  ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH
} from "../academic-workspace-runtime";
import {
  AcademicCiteKeySchema,
  AcademicReferenceCardTypeSchema,
  AcademicSectionFileKindSchema
} from "../academic-book";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "../expert-draft";
import { AgentRuntimeRefSchema } from "./agent-event-identity";

const ContentRevisionSchema = z.string().regex(/^v1:\d+:[0-9a-f]{8}$/);

export const AcademicDocumentEditTargetSchema = z
  .object({
    kind: z.literal("document-edit"),
    objectKind: z.enum([
      "foundation",
      "reference_card",
      "framework_stage",
      "section"
    ]),
    targetId: z.string().trim().min(1).max(160),
    sectionDocument: AcademicSectionFileKindSchema.optional(),
    catalogDocumentId: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(256),
    beforeText: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    text: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    baseRevision: ContentRevisionSchema,
    cardMeta: z
      .object({
        citeKey: AcademicCiteKeySchema.optional(),
        cardType: AcademicReferenceCardTypeSchema.optional(),
        title: z
          .string()
          .trim()
          .min(1)
          .max(ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH)
          .optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const AcademicReferenceCardCreateItemSchema = z
  .object({
    provisionalCardId: z.string().trim().min(1).max(160),
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
  })
  .strict();

export const AcademicReferenceCardCreateTargetSchema = z
  .object({
    kind: z.literal("reference-card-create"),
    cards: z
      .array(AcademicReferenceCardCreateItemSchema)
      .min(1)
      .max(ACADEMIC_BATCH_CREATE_MAX_ITEMS)
  })
  .strict();

export const AcademicReferenceCardDeleteTargetSchema = z
  .object({
    kind: z.literal("reference-card-delete"),
    cardId: z.string().trim().min(1).max(160),
    citeKey: AcademicCiteKeySchema,
    title: z.string().trim().min(1).max(256),
    deletedText: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
  })
  .strict();

export const AcademicFrameworkStageMutationTargetSchema = z
  .object({
    kind: z.literal("framework-stage-mutation"),
    mutation: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("create"),
          provisionalStageId: z.string().trim().min(1).max(160),
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
          content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        })
        .strict(),
      z
        .object({
          type: z.literal("update"),
          stageId: z.string().trim().min(1).max(160),
          previousTitle: z
            .string()
            .trim()
            .min(1)
            .max(ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH),
          previousDescription: z
            .string()
            .trim()
            .min(1)
            .max(ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH),
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
          enabled: z.boolean().optional()
        })
        .strict(),
      z
        .object({
          type: z.literal("move"),
          stageId: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(256),
          direction: z.enum(["up", "down"])
        })
        .strict(),
      z
        .object({
          type: z.literal("delete"),
          stageId: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(256),
          deletedText: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        })
        .strict()
    ])
  })
  .strict();

export const AcademicChapterMutationTargetSchema = z
  .object({
    kind: z.literal("chapter-mutation"),
    mutation: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("create"),
          chapters: z
            .array(
              z
                .object({
                  provisionalChapterId: z.string().trim().min(1).max(160),
                  title: z
                    .string()
                    .trim()
                    .min(1)
                    .max(ACADEMIC_CHAPTER_TITLE_MAX_LENGTH)
                })
                .strict()
            )
            .min(1)
            .max(ACADEMIC_BATCH_CREATE_MAX_ITEMS)
        })
        .strict(),
      z
        .object({
          type: z.literal("rename"),
          chapterId: z.string().trim().min(1).max(160),
          previousTitle: z
            .string()
            .trim()
            .min(1)
            .max(ACADEMIC_CHAPTER_TITLE_MAX_LENGTH),
          title: z.string().trim().min(1).max(ACADEMIC_CHAPTER_TITLE_MAX_LENGTH)
        })
        .strict(),
      z
        .object({
          type: z.literal("move"),
          chapterId: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(256),
          direction: z.enum(["up", "down"])
        })
        .strict(),
      z
        .object({
          type: z.literal("delete"),
          chapterId: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(256)
        })
        .strict()
    ])
  })
  .strict();

export const AcademicSectionCreateItemSchema = z
  .object({
    provisionalSectionId: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(ACADEMIC_SECTION_TITLE_MAX_LENGTH),
    chapterId: z.string().trim().min(1).max(160).nullable().optional(),
    afterSectionId: z.string().trim().min(1).max(160).optional(),
    wordCountRequirement: z
      .string()
      .max(ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH)
      .default(""),
    briefContent: z
      .string()
      .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
      .optional(),
    bodyContent: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional(),
    stateContent: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional()
  })
  .strict();

export const AcademicSectionMutationTargetSchema = z
  .object({
    kind: z.literal("section-mutation"),
    mutation: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("create"),
          sections: z
            .array(AcademicSectionCreateItemSchema)
            .min(1)
            .max(ACADEMIC_BATCH_CREATE_MAX_ITEMS)
        })
        .strict(),
      z
        .object({
          type: z.literal("update"),
          sectionId: z.string().trim().min(1).max(160),
          previousTitle: z
            .string()
            .trim()
            .min(1)
            .max(ACADEMIC_SECTION_TITLE_MAX_LENGTH),
          title: z
            .string()
            .trim()
            .min(1)
            .max(ACADEMIC_SECTION_TITLE_MAX_LENGTH),
          chapterId: z.string().trim().min(1).max(160).nullable().optional(),
          afterSectionId: z
            .string()
            .trim()
            .min(1)
            .max(160)
            .nullable()
            .optional(),
          wordCountRequirement: z
            .string()
            .max(ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH)
            .optional(),
          direction: z.enum(["up", "down"]).optional()
        })
        .strict(),
      z
        .object({
          type: z.literal("delete"),
          sectionId: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(256),
          deletedText: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        })
        .strict()
    ])
  })
  .strict();

export const AcademicMutationTargetSchema = z.discriminatedUnion("kind", [
  AcademicDocumentEditTargetSchema,
  AcademicReferenceCardCreateTargetSchema,
  AcademicReferenceCardDeleteTargetSchema,
  AcademicFrameworkStageMutationTargetSchema,
  AcademicChapterMutationTargetSchema,
  AcademicSectionMutationTargetSchema
]);
export type AcademicMutationTarget = z.infer<
  typeof AcademicMutationTargetSchema
>;

export const AcademicWorkspaceMutationPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    workspaceId: z.string().min(1).max(240),
    summary: z.string().min(1).max(1_000),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    target: AcademicMutationTargetSchema,
    runtime: AgentRuntimeRefSchema
  })
  .strict();
export type AcademicWorkspaceMutationPayload = z.infer<
  typeof AcademicWorkspaceMutationPayloadSchema
>;
