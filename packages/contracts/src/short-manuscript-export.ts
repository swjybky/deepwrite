import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "./expert-draft";

export const SHORT_MANUSCRIPT_EXPORT_FORMATS = ["docx", "txt", "epub"] as const;
export const ShortManuscriptExportFormatSchema = z.enum(
  SHORT_MANUSCRIPT_EXPORT_FORMATS
);
export type ShortManuscriptExportFormat = z.infer<
  typeof ShortManuscriptExportFormatSchema
>;

export const SHORT_MANUSCRIPT_EXPORT_MAX_CHARACTERS = 64 * 1024 * 1024;

export const ShortManuscriptExportSectionSchema = z.object({
  title: z.string().trim().min(1).max(240),
  content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
});
export type ShortManuscriptExportSection = z.infer<
  typeof ShortManuscriptExportSectionSchema
>;

export const ExportShortManuscriptInputSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    format: ShortManuscriptExportFormatSchema,
    sections: z.array(ShortManuscriptExportSectionSchema).min(1).max(100)
  })
  .superRefine((value, context) => {
    const characterCount = value.sections.reduce(
      (total, section) => total + section.title.length + section.content.length,
      value.title.length
    );
    if (characterCount > SHORT_MANUSCRIPT_EXPORT_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Short manuscript export is too large."
      });
    }
  });
export type ExportShortManuscriptInput = z.infer<
  typeof ExportShortManuscriptInputSchema
>;

export const ExportShortManuscriptResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }),
  z.object({
    status: z.literal("saved"),
    filePath: z.string().min(1)
  })
]);
export type ExportShortManuscriptResult = z.infer<
  typeof ExportShortManuscriptResultSchema
>;

export const ExportShortManuscriptCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("manuscript.exportShort"),
    payload: ExportShortManuscriptInputSchema
  });
export type ExportShortManuscriptCommandEnvelope = z.infer<
  typeof ExportShortManuscriptCommandEnvelopeSchema
>;
