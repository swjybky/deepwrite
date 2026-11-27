import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ModelConfigSchema,
  ModelConfigInputSchema,
  AgentProviderRuntimeConfigSchema,
  MODEL_CONTEXT_WINDOW_MAX,
  ModelApiSchema,
  ToolSchemaProfileSchema,
  ThinkingLevelSchema,
  ThinkingLevelOptionsSchema,
  TemperatureOptionsSchema,
  ModelContextWindowSchema,
  ModelMaxTokensSchema
} from "./model-configuration";
export * from "./model-configuration";

export const ModelSettingsSchema = z
  .object({
    models: z.array(ModelConfigSchema).max(100),
    defaultModelId: z.string().max(120),
    deepwriteFreeModels: z.array(ModelConfigSchema).max(50).optional(),
    deepwriteFreeEnabledModelIds: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
    deepwriteFreeDeprecatedModels: z
      .array(ModelConfigSchema)
      .max(50)
      .optional(),
    deepwriteFreeDefaultModelId: z.string().max(120).optional(),
    deepwriteFreeMessage: z.string().max(500).optional()
  })
  .superRefine((value, context) => {
    if (
      value.defaultModelId &&
      !value.models.some((model) => model.id === value.defaultModelId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultModelId"],
        message: "Default model must reference an existing model."
      });
    }
  });
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export const ModelSettingsInputSchema = z
  .object({
    models: z.array(ModelConfigInputSchema).max(100),
    defaultModelId: z.string().max(120)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.models.forEach((model, index) => {
      if (ids.has(model.id)) {
        context.addIssue({
          code: "custom",
          path: ["models", index, "id"],
          message: "Model ids must be unique."
        });
      }
      ids.add(model.id);
    });
    if (value.defaultModelId && !ids.has(value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        path: ["defaultModelId"],
        message: "Default model must reference an existing model."
      });
    }
  });
export type ModelSettingsInput = z.infer<typeof ModelSettingsInputSchema>;

/**
 * Kept local to the model-test contract to avoid a `models -> session -> models`
 * dependency cycle. Its shape intentionally matches `AgentUsage`.
 */
export const ModelConnectionTestUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});
export type ModelConnectionTestUsage = z.infer<
  typeof ModelConnectionTestUsageSchema
>;

export const ModelConnectionTestResultSchema = z.object({
  modelId: z.string().min(1),
  ok: z.boolean(),
  message: z.string().min(1),
  testedAt: z.string().datetime(),
  /** Runtime-resolved context window used after this successful test. */
  contextWindow: z.number().int().positive().max(MODEL_CONTEXT_WINDOW_MAX),
  /** Runtime-resolved max output tokens used after this successful test. */
  maxTokens: z.number().int().positive().max(MODEL_CONTEXT_WINDOW_MAX),
  /** Present when the test detected or used an explicit developer-role compatibility setting. */
  supportsDeveloperRole: z.boolean().optional(),
  /** Present when the provider returned token accounting for this test call. */
  usage: ModelConnectionTestUsageSchema.optional()
});
export type ModelConnectionTestResult = z.infer<
  typeof ModelConnectionTestResultSchema
>;

export const ModelsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.list"),
  payload: z.object({})
});

export const ModelsRefreshFreeCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("models.refreshFree"),
    payload: z.object({})
  }
);

export const ModelsSetFreeModelEnabledCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.setFreeModelEnabled"),
    payload: z.object({
      modelId: z.string().trim().min(1).max(120),
      enabled: z.boolean()
    })
  });

export const ModelsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.save"),
  payload: ModelSettingsInputSchema
});

export const ModelTestRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/u);

export const ModelTestCancelInputSchema = z
  .object({
    requestId: ModelTestRequestIdSchema
  })
  .strict();
export type ModelTestCancelInput = z.infer<typeof ModelTestCancelInputSchema>;

export const ModelTestCancelResultSchema = z
  .object({
    cancelled: z.boolean()
  })
  .strict();
export type ModelTestCancelResult = z.infer<typeof ModelTestCancelResultSchema>;

export const ModelsTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.test"),
  payload: z.object({
    model: ModelConfigInputSchema,
    requestId: ModelTestRequestIdSchema.optional()
  })
});

export const ModelsCancelTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.cancelTest"),
  payload: ModelTestCancelInputSchema
});

export const ModelCapacityResultSchema = z.object({
  modelId: z.string().min(1),
  contextWindow: z.number().int().positive().max(MODEL_CONTEXT_WINDOW_MAX),
  maxTokens: z.number().int().positive().max(MODEL_CONTEXT_WINDOW_MAX)
});
export type ModelCapacityResult = z.infer<typeof ModelCapacityResultSchema>;

export const ModelsResolveCapacityCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.resolveCapacity"),
    payload: z.object({ model: ModelConfigInputSchema })
  });

export const RemoteModelListInputSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  provider: z.string().trim().min(1).max(120),
  api: ModelApiSchema,
  baseUrl: z.union([z.literal(""), z.url().max(2_000)]),
  apiKey: z.string().trim().max(16_000).optional(),
  clearApiKey: z.boolean().optional()
});
export type RemoteModelListInput = z.infer<typeof RemoteModelListInputSchema>;

export const RemoteModelListItemSchema = z.object({
  id: z.string().trim().min(1).max(240),
  sort: z.number().int().nonnegative().optional(),
  label: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(500).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  api: ModelApiSchema.optional(),
  requestModelId: z.string().trim().min(1).max(240).optional(),
  supportsDeveloperRole: z.boolean().optional(),
  toolSchemaProfile: ToolSchemaProfileSchema.optional(),
  reasoning: z.boolean().optional(),
  defaultThinkingLevel: ThinkingLevelSchema.optional(),
  thinkingLevelOptions: ThinkingLevelOptionsSchema.removeDefault().optional(),
  temperatureOptions: TemperatureOptionsSchema.removeDefault().optional(),
  contextWindow: ModelContextWindowSchema.optional(),
  maxTokens: ModelMaxTokensSchema.optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  discount: z.number().finite().positive().max(1).optional(),
  input: z.number().finite().nonnegative().optional(),
  output: z.number().finite().nonnegative().optional(),
  cache: z.number().finite().nonnegative().optional()
});
export type RemoteModelListItem = z.infer<typeof RemoteModelListItemSchema>;

export const RemoteModelListResultSchema = z.object({
  models: z.array(RemoteModelListItemSchema).max(2_000)
});
export type RemoteModelListResult = z.infer<typeof RemoteModelListResultSchema>;

export const ModelsListRemoteCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.listRemote"),
  payload: RemoteModelListInputSchema
});

export const AgentModelTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.model_test"),
  payload: z.object({
    runtimeConfig: AgentProviderRuntimeConfigSchema,
    requestId: ModelTestRequestIdSchema.optional()
  })
});

export const AgentModelTestCancelCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.model_test_cancel"),
    payload: ModelTestCancelInputSchema
  });

export const AgentModelCapacityCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.model_capacity"),
    payload: z.object({ runtimeConfig: AgentProviderRuntimeConfigSchema })
  });

export * from "./site-official-models";
