import { ChatAssistantProjectRefSchema } from "./chat-assistant-base";
import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const LONG_MANUSCRIPT_EXPORT_SECTIONS = [
  "worldbuilding",
  "characters",
  "plot",
  "manuscript"
] as const;
export const LongManuscriptExportSectionSchema = z.enum(
  LONG_MANUSCRIPT_EXPORT_SECTIONS
);
export type LongManuscriptExportSection = z.infer<
  typeof LongManuscriptExportSectionSchema
>;

export const LongManuscriptExportModeSchema = z.enum([
  "folder",
  "single-file",
  "single-txt"
]);
export type LongManuscriptExportMode = z.infer<
  typeof LongManuscriptExportModeSchema
>;

export const LongManuscriptExportFormatSchema = z.enum(["txt", "md"]);
export type LongManuscriptExportFormat = z.infer<
  typeof LongManuscriptExportFormatSchema
>;

export const LongManuscriptExportFileSchema = z
  .object({
    path: z.array(z.string().trim().min(1).max(256)).min(2).max(8),
    content: z.string().max(2_000_000)
  })
  .strict();
export type LongManuscriptExportFile = z.infer<
  typeof LongManuscriptExportFileSchema
>;

export const LONG_MANUSCRIPT_EXPORT_MAX_CHARACTERS = 256 * 1024 * 1024;

export const ExportLongManuscriptInputSchema = z
  .object({
    book: ChatAssistantProjectRefSchema,
    title: z.string().trim().min(1).max(256),
    mode: LongManuscriptExportModeSchema.optional(),
    format: LongManuscriptExportFormatSchema.optional(),
    sections: z.array(LongManuscriptExportSectionSchema).min(1).max(4),
    files: z.array(LongManuscriptExportFileSchema).max(500_000)
  })
  .strict()
  .superRefine((value, context) => {
    const uniqueSections = new Set(value.sections);
    if (uniqueSections.size !== value.sections.length) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Long manuscript export sections must be unique."
      });
    }
    const characterCount = value.files.reduce(
      (total, file) => total + file.content.length + file.path.join("").length,
      value.title.length
    );
    if (characterCount > LONG_MANUSCRIPT_EXPORT_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Long manuscript export is too large."
      });
    }
  });
export type ExportLongManuscriptInput = z.infer<
  typeof ExportLongManuscriptInputSchema
>;

export const ExportLongManuscriptResultSchema = z.union([
  z.object({ status: z.literal("cancelled") }),
  z.object({
    status: z.literal("saved"),
    missingImages: z.number().int().nonnegative(),
    directoryPath: z.string().min(1),
    fileCount: z.number().int().nonnegative()
  }),
  z.object({
    status: z.literal("saved"),
    missingImages: z.number().int().nonnegative(),
    filePath: z.string().min(1),
    fileCount: z.literal(1)
  })
]);
export type ExportLongManuscriptResult = z.infer<
  typeof ExportLongManuscriptResultSchema
>;

export const ExportLongManuscriptCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("manuscript.exportLong"),
    payload: ExportLongManuscriptInputSchema
  });
