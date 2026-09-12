import { z } from "zod";
import {
  CONVERSATION_HISTORY_PAGE_BYTES,
  ConversationHistoryIdSchema,
  ConversationHistoryKeySchema,
  ConversationHistoryPathSchema,
  ConversationHistoryRecordSchema
} from "./conversation-history-mutations";

const RevisionSchema = z.number().int().nonnegative();
const PageSizeSchema = z.number().int().min(1).max(200);
const ByteBudgetSchema = z
  .number()
  .int()
  .min(1024)
  .max(CONVERSATION_HISTORY_PAGE_BYTES);

export const ConversationHistoryDetailReferenceSchema = z
  .object({
    path: ConversationHistoryPathSchema.or(z.tuple([])),
    /** UTF-8 JSON size, or a UTF-8 size upper bound for a text stream. */
    byteLength: RevisionSchema,
    encoding: z.enum(["text", "json"])
  })
  .strict();

export const ConversationHistorySessionSchema = z
  .object({
    sessionId: ConversationHistoryIdSchema,
    metadata: ConversationHistoryRecordSchema,
    metadataDetails: z
      .array(ConversationHistoryDetailReferenceSchema)
      .optional(),
    metadataByteLength: RevisionSchema.optional(),
    summary: z
      .object({
        title: z.string().max(42),
        preview: z.string().max(76),
        turnCount: RevisionSchema
      })
      .strict()
      .optional(),
    revision: RevisionSchema,
    generation: RevisionSchema,
    sequence: RevisionSchema,
    deleted: z.boolean(),
    messageCount: RevisionSchema,
    byteLength: RevisionSchema
  })
  .strict();
export type ConversationHistorySession = z.infer<
  typeof ConversationHistorySessionSchema
>;

export const ConversationHistoryListQuerySchema = z
  .object({
    key: ConversationHistoryKeySchema,
    includeDeleted: z.boolean().default(false),
    afterSessionId: ConversationHistoryIdSchema.optional(),
    limit: PageSizeSchema.default(50),
    maxBytes: ByteBudgetSchema.default(CONVERSATION_HISTORY_PAGE_BYTES)
  })
  .strict();
export const ConversationHistoryListResultSchema = z
  .object({
    activeSessionId: ConversationHistoryIdSchema.nullable(),
    sessions: z.array(ConversationHistorySessionSchema).max(200),
    nextSessionId: ConversationHistoryIdSchema.nullable()
  })
  .strict();

const ConversationHistorySessionIdentitySchema = z
  .object({
    key: ConversationHistoryKeySchema,
    sessionId: ConversationHistoryIdSchema
  })
  .strict();
export const ConversationHistorySessionQuerySchema =
  ConversationHistorySessionIdentitySchema.extend({
    maxBytes: ByteBudgetSchema.default(CONVERSATION_HISTORY_PAGE_BYTES)
  }).strict();

export const ConversationHistoryMessagesQuerySchema =
  ConversationHistorySessionIdentitySchema.extend({
    afterPosition: z.number().int().nonnegative().optional(),
    direction: z.enum(["forward", "backward"]).default("forward"),
    limit: PageSizeSchema.default(50),
    maxBytes: ByteBudgetSchema.default(CONVERSATION_HISTORY_PAGE_BYTES)
  }).strict();

export const ConversationHistoryMessageSchema = z
  .object({
    messageId: ConversationHistoryIdSchema,
    position: RevisionSchema,
    value: ConversationHistoryRecordSchema,
    details: z.array(ConversationHistoryDetailReferenceSchema),
    byteLength: RevisionSchema
  })
  .strict();
export type ConversationHistoryMessage = z.infer<
  typeof ConversationHistoryMessageSchema
>;
export const ConversationHistoryMessagesResultSchema = z
  .object({
    revision: RevisionSchema,
    generation: RevisionSchema,
    messages: z.array(ConversationHistoryMessageSchema).max(200),
    nextPosition: RevisionSchema.nullable()
  })
  .strict();

export const ConversationHistoryDetailQuerySchema =
  ConversationHistorySessionIdentitySchema.extend({
    messageId: ConversationHistoryIdSchema,
    path: ConversationHistoryPathSchema.or(z.tuple([])),
    /** UTF-16 offset into the selected text or JSON stream; never a file offset. */
    offset: RevisionSchema.default(0),
    maxBytes: ByteBudgetSchema.default(CONVERSATION_HISTORY_PAGE_BYTES),
    expectedRevision: RevisionSchema
  }).strict();
export const ConversationHistoryDetailResultSchema = z
  .object({
    revision: RevisionSchema,
    encoding: z.enum(["text", "json"]),
    chunk: z.string(),
    nextOffset: RevisionSchema.nullable(),
    totalBytes: RevisionSchema
  })
  .strict();

export const ConversationHistoryMetadataDetailQuerySchema =
  ConversationHistoryDetailQuerySchema.omit({ messageId: true });

export const ConversationHistoryTurnsQuerySchema =
  ConversationHistorySessionIdentitySchema.extend({
    afterPosition: RevisionSchema.optional(),
    limit: z.number().int().min(1).max(1000).default(200)
  }).strict();
export const ConversationHistoryTurnsResultSchema = z
  .object({
    revision: RevisionSchema,
    turns: z
      .array(
        z
          .object({
            messageId: ConversationHistoryIdSchema,
            position: RevisionSchema,
            preview: z.string().max(300)
          })
          .strict()
      )
      .max(1000),
    nextPosition: RevisionSchema.nullable()
  })
  .strict();

export type ConversationHistoryListQuery = z.input<
  typeof ConversationHistoryListQuerySchema
>;
export type ConversationHistoryListResult = z.infer<
  typeof ConversationHistoryListResultSchema
>;
export type ConversationHistorySessionQuery = z.input<
  typeof ConversationHistorySessionQuerySchema
>;
export type ConversationHistoryMetadataDetailQuery = z.input<
  typeof ConversationHistoryMetadataDetailQuerySchema
>;
export type ConversationHistoryMessagesQuery = z.input<
  typeof ConversationHistoryMessagesQuerySchema
>;
export type ConversationHistoryMessagesResult = z.infer<
  typeof ConversationHistoryMessagesResultSchema
>;
export type ConversationHistoryDetailQuery = z.input<
  typeof ConversationHistoryDetailQuerySchema
>;
export type ConversationHistoryDetailResult = z.infer<
  typeof ConversationHistoryDetailResultSchema
>;
export type ConversationHistoryTurnsQuery = z.input<
  typeof ConversationHistoryTurnsQuerySchema
>;
export type ConversationHistoryTurnsResult = z.infer<
  typeof ConversationHistoryTurnsResultSchema
>;
