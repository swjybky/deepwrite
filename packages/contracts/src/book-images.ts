import { z } from "zod";
import { ChatAssistantProjectRefSchema } from "./chat-assistant-base";
import { EnvelopeBaseSchema } from "./envelope";

export const BOOK_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const BOOK_IMAGE_MAX_DIMENSION = 8192;
export const BOOK_IMAGE_MAX_SELECTION = 10;
export const BOOK_IMAGE_EXPORT_MAX_BYTES = 512 * 1024 * 1024;

// References are always relative to the book root, never the Markdown file.
const imagePathPattern = /^images\/[^/\\\s)]{1,120}\.(?:png|jpe?g)$/u;
export const BookImagePathSchema = z
  .string()
  .regex(imagePathPattern)
  .refine(
    (path) => !/[\u0000-\u001f\u007f]/u.test(path) && !path.includes(".."),
    "Invalid book image path."
  );
export type BookImageReference = { path: string; alt: string };
export function parseBookImageLine(
  line: string
): BookImageReference | undefined {
  const match =
    /^!\[([^\]\n]{0,200})\]\((images\/[^/\\\s)]{1,120}\.(?:png|jpe?g))\)$/u.exec(
      line.trim()
    );
  if (!match || !BookImagePathSchema.safeParse(match[2]).success)
    return undefined;
  return { path: match[2]!, alt: match[1]! };
}
export const BookImageReferenceSchema = z
  .object({
    path: BookImagePathSchema,
    alt: z
      .string()
      .max(200)
      .regex(/^[^\]\n]*$/u)
  })
  .strict();
export const BookImageErrorCodeSchema = z.enum([
  "book_image.unsupported_format",
  "book_image.too_large",
  "book_image.invalid_dimensions",
  "book_image.write_failed",
  "book_image.export_too_large"
]);
export type BookImageErrorCode = z.infer<typeof BookImageErrorCodeSchema>;
export const BookImageBookRefSchema = z.union([
  ChatAssistantProjectRefSchema,
  z
    .object({
      projectType: z.literal("mystery"),
      projectId: z.string().trim().min(1).max(512)
    })
    .strict()
]);
export type BookImageBookRef = z.infer<typeof BookImageBookRefSchema>;

export const BookImagesPickInputSchema = z
  .object({ book: BookImageBookRefSchema })
  .strict();
export type BookImagesPickInput = z.infer<typeof BookImagesPickInputSchema>;
export const BookImagesPickResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }).strict(),
  z
    .object({
      status: z.literal("saved"),
      images: z.array(BookImageReferenceSchema).max(BOOK_IMAGE_MAX_SELECTION),
      rejected: z
        .array(
          z
            .object({
              name: z.string().max(512),
              code: BookImageErrorCodeSchema
            })
            .strict()
        )
        .max(BOOK_IMAGE_MAX_SELECTION)
    })
    .strict()
]);
export type BookImagesPickResult = z.infer<typeof BookImagesPickResultSchema>;
export const BookImagesWriteInputSchema = BookImagesPickInputSchema.extend({
  images: z
    .array(
      z
        .object({
          bytes: z
            .string()
            .min(4)
            .max(Math.ceil(BOOK_IMAGE_MAX_BYTES / 3) * 4)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
            .refine((value) => value.length % 4 === 0, "Invalid image bytes."),
          ext: z.enum(["png", "jpg"]),
          baseName: z.string().max(512)
        })
        .strict()
    )
    .min(1)
    .max(BOOK_IMAGE_MAX_SELECTION)
});
export type BookImagesWriteInput = z.infer<typeof BookImagesWriteInputSchema>;
export const BookImagesWriteResultSchema = z
  .object({
    images: z
      .array(BookImageReferenceSchema)
      .min(1)
      .max(BOOK_IMAGE_MAX_SELECTION)
  })
  .strict();
export const BookImagesResolveInputSchema = BookImagesPickInputSchema.extend({
  path: BookImagePathSchema
});
export const BookImagesResolveResultSchema = z
  .object({
    path: z.string().min(1).max(4096),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    byteSize: z.number().int().positive().max(BOOK_IMAGE_MAX_BYTES)
  })
  .strict();
export type BookImagesResolveResult = z.infer<
  typeof BookImagesResolveResultSchema
>;
export const BookImagesCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("bookImages.pick"),
    payload: BookImagesPickInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("bookImages.write"),
    payload: BookImagesWriteInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("bookImages.resolve"),
    payload: BookImagesResolveInputSchema
  })
] as const;
export interface BookImagesApi {
  pick(input: BookImagesPickInput): Promise<BookImagesPickResult>;
}
