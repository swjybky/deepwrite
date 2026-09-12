import { z } from "zod";
import { conversationHistoryJsonBytes } from "./conversation-history-json-size";
export { conversationHistoryJsonBytes } from "./conversation-history-json-size";
import { RendererStateKeySchema } from "./renderer-state-key";
import {
  CONVERSATION_HISTORY_BATCH_BYTES,
  CONVERSATION_HISTORY_TEXT_CHUNK_SIZE
} from "./conversation-history-limits";
export * from "./conversation-history-limits";

export const ConversationHistoryKeySchema = RendererStateKeySchema.refine(
  (key) => key.startsWith("conversation-history:")
);
export const ConversationHistoryIdSchema = z.string().min(1).max(240);
export const ConversationHistoryJsonSchema = z.json();
export const ConversationHistoryRecordSchema = z.record(
  z.string(),
  ConversationHistoryJsonSchema
);
export type ConversationHistoryJson = z.infer<
  typeof ConversationHistoryJsonSchema
>;
export type ConversationHistoryRecord = z.infer<
  typeof ConversationHistoryRecordSchema
>;

export const ConversationHistoryPathSchema = z
  .array(
    z.union([
      z
        .string()
        .max(1024)
        .refine(
          (part) => !["__proto__", "prototype", "constructor"].includes(part)
        ),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    ])
  )
  .min(1)
  .max(80);

export const ConversationHistoryChangeSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set"),
      path: ConversationHistoryPathSchema,
      value: ConversationHistoryJsonSchema
    })
    .strict(),
  z
    .object({ op: z.literal("remove"), path: ConversationHistoryPathSchema })
    .strict(),
  z
    .object({
      op: z.literal("append"),
      path: ConversationHistoryPathSchema,
      text: z.string().max(CONVERSATION_HISTORY_TEXT_CHUNK_SIZE)
    })
    .strict()
]);
export type ConversationHistoryChange = z.infer<
  typeof ConversationHistoryChangeSchema
>;

export const ConversationHistoryOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("moveMessage"),
      messageId: ConversationHistoryIdSchema,
      position: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      type: z.literal("putMessage"),
      messageId: ConversationHistoryIdSchema,
      position: z.number().int().nonnegative(),
      value: ConversationHistoryRecordSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("putStagedMessage"),
      stageId: ConversationHistoryIdSchema,
      messageId: ConversationHistoryIdSchema,
      position: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      type: z.literal("setStagedField"),
      stageId: ConversationHistoryIdSchema,
      messageId: ConversationHistoryIdSchema,
      path: ConversationHistoryPathSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("patchMessage"),
      messageId: ConversationHistoryIdSchema,
      changes: z.array(ConversationHistoryChangeSchema).min(1).max(4096)
    })
    .strict(),
  z
    .object({
      type: z.literal("removeMessages"),
      messageIds: z.array(ConversationHistoryIdSchema).min(1).max(4096)
    })
    .strict(),
  z
    .object({
      type: z.literal("setMetadata"),
      value: ConversationHistoryRecordSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("setStagedMetadata"),
      stageId: ConversationHistoryIdSchema,
      path: ConversationHistoryPathSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("setActive"),
      sessionId: ConversationHistoryIdSchema
    })
    .strict(),
  z.object({ type: z.literal("setDeleted"), deleted: z.boolean() }).strict()
]);
export type ConversationHistoryOperation = z.infer<
  typeof ConversationHistoryOperationSchema
>;

export const ConversationHistoryBatchSchema = z
  .object({
    key: ConversationHistoryKeySchema,
    sessionId: ConversationHistoryIdSchema,
    batchId: ConversationHistoryIdSchema,
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    operations: z.array(ConversationHistoryOperationSchema).min(1).max(4096)
  })
  .strict()
  .refine(
    (batch) =>
      conversationHistoryJsonBytes(batch, CONVERSATION_HISTORY_BATCH_BYTES) <=
      CONVERSATION_HISTORY_BATCH_BYTES,
    "Conversation history batch exceeds its transport byte budget."
  );
export type ConversationHistoryBatch = z.infer<
  typeof ConversationHistoryBatchSchema
>;

export const ConversationHistoryCommitResultSchema = z
  .object({
    batchId: ConversationHistoryIdSchema,
    revision: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative()
  })
  .strict();
export type ConversationHistoryCommitResult = z.infer<
  typeof ConversationHistoryCommitResultSchema
>;

export const ConversationHistoryStageSchema = z
  .object({
    key: ConversationHistoryKeySchema,
    sessionId: ConversationHistoryIdSchema,
    stageId: ConversationHistoryIdSchema,
    target: z.literal("metadata").optional(),
    messageId: ConversationHistoryIdSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
    chunkId: ConversationHistoryIdSchema,
    sequence: z.number().int().positive(),
    value: ConversationHistoryRecordSchema.optional(),
    changes: z
      .array(ConversationHistoryChangeSchema)
      .min(1)
      .max(4096)
      .optional()
  })
  .strict()
  .refine(
    (batch) =>
      batch.target === "metadata"
        ? batch.messageId === undefined
        : batch.messageId !== undefined,
    "Message stages require a message ID; metadata stages must omit it."
  )
  .refine(
    (batch) => batch.value !== undefined || batch.changes !== undefined,
    "Staging requires message data."
  )
  .refine(
    (batch) =>
      conversationHistoryJsonBytes(batch, CONVERSATION_HISTORY_BATCH_BYTES) <=
      CONVERSATION_HISTORY_BATCH_BYTES,
    "Conversation history stage exceeds its transport byte budget."
  );
export type ConversationHistoryStage = z.infer<
  typeof ConversationHistoryStageSchema
>;
export const ConversationHistoryStageResultSchema = z
  .object({
    stageId: ConversationHistoryIdSchema,
    chunkId: ConversationHistoryIdSchema,
    sequence: z.number().int().positive()
  })
  .strict();
export type ConversationHistoryStageResult = z.infer<
  typeof ConversationHistoryStageResultSchema
>;
