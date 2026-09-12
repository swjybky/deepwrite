import { z } from "zod";
import {
  ConversationHistoryIdSchema,
  ConversationHistoryKeySchema
} from "./conversation-history-mutations";

/** Consolidates the existing per-stage keys without sending their records to Renderer. */
export const ConversationHistoryMergeScopesQuerySchema = z
  .object({
    key: ConversationHistoryKeySchema,
    sources: z.array(ConversationHistoryKeySchema).max(1024)
  })
  .strict()
  .refine((input) => input.sources.every((key) => key !== input.key), {
    message: "A conversation scope cannot be merged into itself."
  });
export const ConversationHistoryMergeScopesResultSchema = z
  .object({
    mergedSources: z.array(ConversationHistoryKeySchema).max(1024),
    activeSessionId: ConversationHistoryIdSchema.nullable()
  })
  .strict();
export type ConversationHistoryMergeScopesQuery = z.infer<
  typeof ConversationHistoryMergeScopesQuerySchema
>;
export type ConversationHistoryMergeScopesResult = z.infer<
  typeof ConversationHistoryMergeScopesResultSchema
>;
