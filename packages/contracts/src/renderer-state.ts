import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ConversationHistoryCommandEnvelopeSchemas,
  type ConversationHistoryApi
} from "./conversation-history";

export * from "./renderer-state-key";
import { RendererStateKeySchema } from "./renderer-state-key";

const RendererStateSavePayloadSchema = z
  .object({
    key: RendererStateKeySchema,
    value: z.unknown()
  })
  .strict()
  .superRefine((payload, context) => {
    if (!Object.prototype.hasOwnProperty.call(payload, "value")) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Renderer state save payload must include a value."
      });
    }
  });

export const RendererStateLoadResultSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }).strict(),
  z
    .object({ found: z.literal(true), value: z.unknown() })
    .strict()
    .superRefine((result, context) => {
      if (!Object.prototype.hasOwnProperty.call(result, "value")) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: "A found renderer state result must include its value."
        });
      }
    })
]);
export type RendererStateLoadResult = z.infer<
  typeof RendererStateLoadResultSchema
>;

export const RendererStateMutationResultSchema = z
  .object({ ok: z.literal(true) })
  .strict();
export type RendererStateMutationResult = z.infer<
  typeof RendererStateMutationResultSchema
>;

export const RendererStateLoadCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("rendererState.load"),
    payload: z.object({ key: RendererStateKeySchema }).strict()
  }
);

export const RendererStateSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("rendererState.save"),
    payload: RendererStateSavePayloadSchema
  }
);

export const RendererStateRemoveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.remove"),
    payload: z.object({ key: RendererStateKeySchema }).strict()
  });

export const RendererStateHistoryKeysResultSchema = z.array(
  RendererStateKeySchema
);
export const RendererStateListHistoryKeysCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.listHistoryKeys"),
    payload: z.object({}).strict()
  });

const HistoryKeySchema = RendererStateKeySchema.refine((key) =>
  key.startsWith("conversation-history:")
);
export const RendererStateHistoryMigrationSchema = z
  .object({
    key: HistoryKeySchema,
    value: z.unknown(),
    expected: RendererStateLoadResultSchema,
    sources: z.array(
      z.object({ key: HistoryKeySchema, value: z.unknown() }).strict()
    )
  })
  .strict()
  .superRefine((migration, context) => {
    const keys = [
      migration.key,
      ...migration.sources.map((source) => source.key)
    ];
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "History migration keys must be distinct."
      });
    }
    if (
      !Object.hasOwn(migration, "value") ||
      migration.sources.some((source) => !Object.hasOwn(source, "value"))
    ) {
      context.addIssue({
        code: "custom",
        message: "History migration values are required."
      });
    }
  });
export type RendererStateHistoryMigration = z.infer<
  typeof RendererStateHistoryMigrationSchema
>;
export const RendererStateMigrationResultSchema = z
  .object({ ok: z.boolean() })
  .strict();
export const RendererStateMigrateHistoryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.migrateHistory"),
    payload: RendererStateHistoryMigrationSchema
  });

export interface ConversationPersistenceApi {
  /** Incremental, paginated durable history; legacy load/save remain migration-only. */
  history?: ConversationHistoryApi;
  /** The handler resolves only after pending conversation writes reach Core. */
  onBeforeClose?(handler: () => Promise<void>): () => void;
  /** Available in clients supporting book-level history migration. */
  listHistoryKeys?(): Promise<string[]>;
  /** Atomically replaces unchanged sources; false means a concurrent edit won. */
  migrateHistory?(migration: RendererStateHistoryMigration): Promise<boolean>;
  load(key: string): Promise<unknown | undefined>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export const RendererStateFlushReadyCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.flushReady"),
    payload: z.object({ enabled: z.boolean() }).strict()
  });

export const RendererStateFlushCompletedCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.flushCompleted"),
    payload: z
      .object({ requestId: z.string().min(1).max(120), ok: z.boolean() })
      .strict()
  });

export const RendererStateFlushRequestedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("rendererState.flushRequested"),
    payload: z.object({}).strict()
  });

export const RendererStateCommandEnvelopeSchemas = [
  ...ConversationHistoryCommandEnvelopeSchemas,
  RendererStateListHistoryKeysCommandEnvelopeSchema,
  RendererStateMigrateHistoryCommandEnvelopeSchema,
  RendererStateLoadCommandEnvelopeSchema,
  RendererStateSaveCommandEnvelopeSchema,
  RendererStateRemoveCommandEnvelopeSchema,
  RendererStateFlushReadyCommandEnvelopeSchema,
  RendererStateFlushCompletedCommandEnvelopeSchema
] as const;
