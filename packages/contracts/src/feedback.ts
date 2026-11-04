import { z } from "zod";

/**
 * User feedback sent to DeepwriteApi. Sign-in is shared with the skill
 * marketplace (`marketplace` API); a user only ever reads their own feedback.
 */
export const FEEDBACK_IPC_CHANNEL = "deepwrite:feedback" as const;
export const FEEDBACK_CONTENT_MAX_LENGTH = 5_000;
export const FEEDBACK_MAX_IMAGES = 3;
/** Server limit; keeps a base64 image inside Main's 2 MiB response limit. */
export const FEEDBACK_IMAGE_MAX_BYTES = 1_400_000;
export const FEEDBACK_PAGE_SIZE = 10;
const FEEDBACK_IMAGE_MAX_BASE64_LENGTH =
  Math.ceil(FEEDBACK_IMAGE_MAX_BYTES / 3) * 4;
/** An uncompressed PNG of the window; the Renderer compresses it before sending. */
const FEEDBACK_CAPTURE_MAX_BASE64_LENGTH = 64 * 1024 * 1024;

const Base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;
const RemoteIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });

export const FeedbackTagSchema = z.enum(["bug", "feature"]);
export type FeedbackTag = z.infer<typeof FeedbackTagSchema>;

export const FeedbackStatusSchema = z.enum(["open", "processing", "done"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;

export const FeedbackSubmitInputSchema = z
  .object({
    tag: FeedbackTagSchema.optional(),
    content: z.string().trim().min(1).max(FEEDBACK_CONTENT_MAX_LENGTH),
    images: z
      .array(
        z
          .string()
          .min(1)
          .max(FEEDBACK_IMAGE_MAX_BASE64_LENGTH)
          .regex(Base64Pattern)
      )
      .max(FEEDBACK_MAX_IMAGES)
  })
  .strict();
export type FeedbackSubmitInput = z.infer<typeof FeedbackSubmitInputSchema>;

export const FeedbackListFilterSchema = z
  .object({ page: z.number().int().min(1).max(1_000_000).optional() })
  .strict();
export type FeedbackListFilter = z.infer<typeof FeedbackListFilterSchema>;

export const FeedbackImageTargetSchema = z
  .object({ feedbackId: RemoteIdSchema, imageId: RemoteIdSchema })
  .strict();
export type FeedbackImageTarget = z.infer<typeof FeedbackImageTargetSchema>;

export const FeedbackImageInfoSchema = z
  .object({
    id: RemoteIdSchema,
    contentType: z.string().min(1).max(64),
    byteSize: z.number().int().nonnegative()
  })
  .strict();
export type FeedbackImageInfo = z.infer<typeof FeedbackImageInfoSchema>;

export const FeedbackItemSchema = z
  .object({
    id: RemoteIdSchema,
    tag: FeedbackTagSchema.optional(),
    content: z.string(),
    status: FeedbackStatusSchema,
    reply: z.string(),
    repliedAt: TimestampSchema.optional(),
    images: z.array(FeedbackImageInfoSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;

export const FeedbackPageSchema = z
  .object({
    items: z.array(FeedbackItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  })
  .strict();
export type FeedbackPage = z.infer<typeof FeedbackPageSchema>;

export const FeedbackImageSchema = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    data: z
      .string()
      .min(1)
      .max(FEEDBACK_CAPTURE_MAX_BASE64_LENGTH)
      .regex(Base64Pattern)
  })
  .strict();
export type FeedbackImage = z.infer<typeof FeedbackImageSchema>;

export const FeedbackIpcRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("list"),
      filter: FeedbackListFilterSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("submit"),
      input: FeedbackSubmitInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("image"),
      target: FeedbackImageTargetSchema
    })
    .strict(),
  z.object({ operation: z.literal("captureWindow") }).strict()
]);
export type FeedbackIpcRequest = z.infer<typeof FeedbackIpcRequestSchema>;
