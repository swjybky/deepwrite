import { z } from "zod";
import { ACADEMIC_MAX_SECTIONS } from "./academic-book";
import { ChatAssistantProjectRefSchema } from "./chat-assistant-base";
import { EnvelopeBaseSchema } from "./envelope";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "./expert-draft";

export const ACADEMIC_MANUSCRIPT_EXPORT_FORMATS = ["docx", "md"] as const;
export const AcademicManuscriptExportFormatSchema = z.enum(
  ACADEMIC_MANUSCRIPT_EXPORT_FORMATS
);
export type AcademicManuscriptExportFormat = z.infer<
  typeof AcademicManuscriptExportFormatSchema
>;

export const ACADEMIC_MANUSCRIPT_IMAGE_MODES = [
  "assets_folder",
  "single_file"
] as const;
export const AcademicManuscriptImageModeSchema = z.enum(
  ACADEMIC_MANUSCRIPT_IMAGE_MODES
);
export type AcademicManuscriptImageMode = z.infer<
  typeof AcademicManuscriptImageModeSchema
>;

export const ACADEMIC_MANUSCRIPT_EXPORT_MAX_CHARACTERS = 128 * 1024 * 1024;

export const AcademicManuscriptExportItemSchema = z
  .object({
    chapterId: z.string().trim().min(1).max(512).optional(),
    chapterTitle: z.string().trim().min(1).max(256).optional(),
    sectionTitle: z.string().trim().min(1).max(256),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
  })
  .strict();
export type AcademicManuscriptExportItem = z.infer<
  typeof AcademicManuscriptExportItemSchema
>;

export const ExportAcademicManuscriptInputSchema = z
  .object({
    book: ChatAssistantProjectRefSchema,
    title: z.string().trim().min(1).max(256),
    format: AcademicManuscriptExportFormatSchema,
    includeChapterHeadings: z.boolean(),
    imageMode: AcademicManuscriptImageModeSchema.optional(),
    items: z
      .array(AcademicManuscriptExportItemSchema)
      .min(1)
      .max(ACADEMIC_MAX_SECTIONS)
  })
  .strict()
  .superRefine((value, context) => {
    const characterCount = value.items.reduce(
      (total, item) =>
        total +
        (item.chapterTitle?.length ?? 0) +
        item.sectionTitle.length +
        item.content.length,
      value.title.length
    );
    if (characterCount > ACADEMIC_MANUSCRIPT_EXPORT_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Academic manuscript export is too large."
      });
    }
  });
export type ExportAcademicManuscriptInput = z.infer<
  typeof ExportAcademicManuscriptInputSchema
>;

export const ExportAcademicManuscriptResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("cancelled") }).strict(),
    z
      .object({
        status: z.literal("saved"),
        filePath: z.string().min(1),
        assetsDirectory: z.string().min(1).optional(),
        missingImages: z.number().int().nonnegative()
      })
      .strict()
  ]
);
export type ExportAcademicManuscriptResult = z.infer<
  typeof ExportAcademicManuscriptResultSchema
>;

export const ExportAcademicManuscriptCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("manuscript.exportAcademic"),
    payload: ExportAcademicManuscriptInputSchema
  });
export type ExportAcademicManuscriptCommandEnvelope = z.infer<
  typeof ExportAcademicManuscriptCommandEnvelopeSchema
>;
