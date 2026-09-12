import {
  ConversationHistoryMergeScopesQuerySchema,
  ConversationHistoryMergeScopesResultSchema,
  type ConversationHistoryMergeScopesQuery,
  type ConversationHistoryMergeScopesResult
} from "./conversation-history-scopes";
export * from "./conversation-history-scopes";
import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryCommitResultSchema,
  ConversationHistoryStageSchema,
  ConversationHistoryStageResultSchema,
  type ConversationHistoryStage,
  type ConversationHistoryStageResult,
  type ConversationHistoryBatch,
  type ConversationHistoryCommitResult
} from "./conversation-history-mutations";
import {
  ConversationHistoryDetailQuerySchema,
  ConversationHistoryDetailResultSchema,
  ConversationHistoryMetadataDetailQuerySchema,
  type ConversationHistoryMetadataDetailQuery,
  ConversationHistoryListQuerySchema,
  ConversationHistoryListResultSchema,
  ConversationHistoryMessagesQuerySchema,
  ConversationHistoryMessagesResultSchema,
  ConversationHistorySessionQuerySchema,
  ConversationHistorySessionSchema,
  ConversationHistoryTurnsQuerySchema,
  ConversationHistoryTurnsResultSchema,
  type ConversationHistoryDetailQuery,
  type ConversationHistoryDetailResult,
  type ConversationHistoryListQuery,
  type ConversationHistoryListResult,
  type ConversationHistoryMessagesQuery,
  type ConversationHistoryMessagesResult,
  type ConversationHistorySessionQuery,
  type ConversationHistorySession,
  type ConversationHistoryTurnsQuery,
  type ConversationHistoryTurnsResult
} from "./conversation-history-queries";

export * from "./conversation-history-mutations";
export * from "./conversation-history-queries";

export const ConversationHistoryCommandEnvelopeSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.mergeScopes"),
    payload: ConversationHistoryMergeScopesQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.metadataDetail"),
    payload: ConversationHistoryMetadataDetailQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.stage"),
    payload: ConversationHistoryStageSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.commit"),
    payload: ConversationHistoryBatchSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.list"),
    payload: ConversationHistoryListQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.session"),
    payload: ConversationHistorySessionQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.messages"),
    payload: ConversationHistoryMessagesQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.detail"),
    payload: ConversationHistoryDetailQuerySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.history.turns"),
    payload: ConversationHistoryTurnsQuerySchema
  })
] as const;

export const ConversationHistoryResultSchemas = {
  "rendererState.history.mergeScopes":
    ConversationHistoryMergeScopesResultSchema,
  "rendererState.history.metadataDetail": ConversationHistoryDetailResultSchema,
  "rendererState.history.stage": ConversationHistoryStageResultSchema,
  "rendererState.history.commit": ConversationHistoryCommitResultSchema,
  "rendererState.history.list": ConversationHistoryListResultSchema,
  "rendererState.history.session": ConversationHistorySessionSchema.nullable(),
  "rendererState.history.messages": ConversationHistoryMessagesResultSchema,
  "rendererState.history.detail": ConversationHistoryDetailResultSchema,
  "rendererState.history.turns": ConversationHistoryTurnsResultSchema
} as const;

export interface ConversationHistoryApi {
  mergeScopes(
    query: ConversationHistoryMergeScopesQuery
  ): Promise<ConversationHistoryMergeScopesResult>;
  metadataDetail(
    query: ConversationHistoryMetadataDetailQuery
  ): Promise<ConversationHistoryDetailResult>;
  stage(
    batch: ConversationHistoryStage
  ): Promise<ConversationHistoryStageResult>;
  commit(
    batch: ConversationHistoryBatch
  ): Promise<ConversationHistoryCommitResult>;
  list(
    query: ConversationHistoryListQuery
  ): Promise<ConversationHistoryListResult>;
  session(
    query: ConversationHistorySessionQuery
  ): Promise<ConversationHistorySession | null>;
  messages(
    query: ConversationHistoryMessagesQuery
  ): Promise<ConversationHistoryMessagesResult>;
  detail(
    query: ConversationHistoryDetailQuery
  ): Promise<ConversationHistoryDetailResult>;
  turns(
    query: ConversationHistoryTurnsQuery
  ): Promise<ConversationHistoryTurnsResult>;
}
