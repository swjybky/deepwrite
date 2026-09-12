import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const CONVERSATION_EXPORT_CHUNK_BYTES = 1024 * 1024;
const TokenSchema = z.string().uuid();
const SequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const ConversationExportBeginSchema = z
  .object({
    nonce: TokenSchema,
    suggestedName: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[^/\\\0]+$/)
  })
  .strict();
export const ConversationExportBeginResultSchema = z.discriminatedUnion(
  "canceled",
  [
    z.object({ canceled: z.literal(true) }).strict(),
    z.object({ canceled: z.literal(false), token: TokenSchema }).strict()
  ]
);
/** Internal Main-to-Core authorization. Renderer must never dispatch this command. */
export const ConversationExportPrepareSchema = z
  .object({
    token: TokenSchema,
    filePath: z
      .string()
      .min(1)
      .max(32768)
      .refine((value) => !value.includes("\0"))
  })
  .strict();
export const ConversationExportAppendSchema = z
  .object({
    token: TokenSchema,
    seq: SequenceSchema,
    text: z
      .string()
      .min(1)
      .max(CONVERSATION_EXPORT_CHUNK_BYTES)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <=
          CONVERSATION_EXPORT_CHUNK_BYTES,
        "Export chunks must not exceed 1 MiB UTF-8."
      )
  })
  .strict();
export const ConversationExportFinishSchema = z
  .object({ token: TokenSchema, seq: SequenceSchema })
  .strict();
export const ConversationExportTokenSchema = z
  .object({ token: TokenSchema })
  .strict();
export const ConversationExportProgressSchema = z
  .object({ nextSeq: SequenceSchema, bytes: z.number().int().nonnegative() })
  .strict();
export const ConversationExportFinishedSchema = z
  .object({
    fileName: z.string().min(1),
    bytes: z.number().int().nonnegative()
  })
  .strict();
export const ConversationExportCanceledSchema = z
  .object({ canceled: z.literal(true) })
  .strict();

export const ConversationExportCommandEnvelopeSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("conversationExport.begin"),
    payload: ConversationExportBeginSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("conversationExport.prepare"),
    payload: ConversationExportPrepareSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("conversationExport.append"),
    payload: ConversationExportAppendSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("conversationExport.finish"),
    payload: ConversationExportFinishSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("conversationExport.cancel"),
    payload: ConversationExportTokenSchema
  })
] as const;
export const ConversationExportResultSchemas = {
  "conversationExport.begin": ConversationExportBeginResultSchema,
  "conversationExport.prepare": ConversationExportProgressSchema,
  "conversationExport.append": ConversationExportProgressSchema,
  "conversationExport.finish": ConversationExportFinishedSchema,
  "conversationExport.cancel": ConversationExportCanceledSchema
} as const;
export type ConversationExportBegin = z.infer<
  typeof ConversationExportBeginSchema
>;
export type ConversationExportBeginResult = z.infer<
  typeof ConversationExportBeginResultSchema
>;
export type ConversationExportAppend = z.infer<
  typeof ConversationExportAppendSchema
>;
export type ConversationExportFinish = z.infer<
  typeof ConversationExportFinishSchema
>;
export type ConversationExportProgress = z.infer<
  typeof ConversationExportProgressSchema
>;
export type ConversationExportFinished = z.infer<
  typeof ConversationExportFinishedSchema
>;
export interface ConversationExportApi {
  begin(input: ConversationExportBegin): Promise<ConversationExportBeginResult>;
  append(input: ConversationExportAppend): Promise<ConversationExportProgress>;
  finish(input: ConversationExportFinish): Promise<ConversationExportFinished>;
  cancel(input: { token: string }): Promise<void>;
}
