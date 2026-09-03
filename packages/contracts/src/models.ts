import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const BUILT_IN_REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;
export type BuiltInReasoningLevel = (typeof BUILT_IN_REASONING_LEVELS)[number];

export const ReasoningLevelSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Thinking levels may only contain English letters, numbers, dots, underscores, and hyphens."
  )
  .refine((value) => value !== "off", {
    message: "The off value is reserved for models without reasoning."
  });
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ThinkingLevelSchema = z.union([
  z.literal("off"),
  ReasoningLevelSchema
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const ThinkingLevelOptionsSchema = z
  .array(ReasoningLevelSchema)
  .min(1)
  .max(BUILT_IN_REASONING_LEVELS.length + 1)
  .default([...BUILT_IN_REASONING_LEVELS])
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({
        code: "custom",
        message: "Thinking level options must be unique."
      });
    }
    const builtInLevels = new Set<string>(BUILT_IN_REASONING_LEVELS);
    if (value.filter((level) => !builtInLevels.has(level)).length > 1) {
      context.addIssue({
        code: "custom",
        message: "Only one custom thinking level may be configured."
      });
    }
  });
export type ThinkingLevelOptions = z.infer<typeof ThinkingLevelOptionsSchema>;

export const TemperatureSchema = z.number().finite().min(0).max(2);
export type Temperature = z.infer<typeof TemperatureSchema>;

export const TemperatureOptionsSchema = z
  .tuple([TemperatureSchema, TemperatureSchema, TemperatureSchema])
  .default([0.1, 0.7, 1])
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({
        code: "custom",
        message: "Temperature options must be unique."
      });
    }
  });
export type TemperatureOptions = z.infer<typeof TemperatureOptionsSchema>;

export const ModelApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
]);
export type ModelApi = z.infer<typeof ModelApiSchema>;

export function isDeepSeekWebSearchCompatible(
  model: { provider: string; api: ModelApi } | null | undefined
): boolean {
  if (!model) return false;
  return (
    model.provider.trim().toLowerCase() === "deepseek" &&
    (model.api === "openai-responses" || model.api === "anthropic-messages")
  );
}

export const ToolSchemaProfileSchema = z.enum(["native", "portable"]);
export type ToolSchemaProfile = z.infer<typeof ToolSchemaProfileSchema>;

export const ModelManagedBySchema = z.enum([
  "deepwrite-free",
  "deepwrite-official"
]);
export type ModelManagedBy = z.infer<typeof ModelManagedBySchema>;

export const DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX =
  "deepwrite-site-official-";

export function isDeepWriteSiteOfficialModel(
  model: string | { id: string } | { configId: string }
): boolean {
  const id =
    typeof model === "string"
      ? model
      : "id" in model
        ? model.id
        : model.configId;
  return id.startsWith(DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX);
}

/** Fallback context window for custom models that are not in the runtime catalog. */
export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 272_000;
/** Fallback max output tokens for custom models that are not in the runtime catalog. */
export const DEFAULT_CUSTOM_MODEL_MAX_TOKENS = 128_000;

export const MODEL_CONTEXT_WINDOW_MIN = 1_024;
export const MODEL_CONTEXT_WINDOW_MAX = 10_000_000;
export const MODEL_MAX_TOKENS_MIN = 1;
export const MODEL_MAX_TOKENS_MAX = 2_000_000;

export const ModelContextWindowSchema = z
  .number()
  .int()
  .min(MODEL_CONTEXT_WINDOW_MIN)
  .max(MODEL_CONTEXT_WINDOW_MAX);
export type ModelContextWindow = z.infer<typeof ModelContextWindowSchema>;

export const ModelMaxTokensSchema = z
  .number()
  .int()
  .min(MODEL_MAX_TOKENS_MIN)
  .max(MODEL_MAX_TOKENS_MAX);
export type ModelMaxTokens = z.infer<typeof ModelMaxTokensSchema>;

const ModelIdentitySchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    provider: z.string().trim().min(1).max(120),
    modelId: z.string().trim().min(1).max(240),
    /** Optional provider-side routing id when it differs from the public model id. */
    requestModelId: z.string().trim().min(1).max(240).optional(),
    /** Whether an OpenAI-compatible endpoint accepts the newer developer message role. */
    supportsDeveloperRole: z.boolean().optional(),
    /** Optional override for provider-facing tool schema complexity. */
    toolSchemaProfile: ToolSchemaProfileSchema.optional(),
    api: ModelApiSchema,
    baseUrl: z.union([z.literal(""), z.url().max(2_000)]),
    reasoning: z.boolean(),
    defaultThinkingLevel: ThinkingLevelSchema,
    thinkingLevelOptions: ThinkingLevelOptionsSchema,
    temperatureOptions: TemperatureOptionsSchema,
    /** Optional custom context window in tokens. Must be set together with maxTokens. */
    contextWindow: ModelContextWindowSchema.optional(),
    /** Optional custom max output tokens. Must be set together with contextWindow. */
    maxTokens: ModelMaxTokensSchema.optional(),
    /** User visibility toggle for separately managed model catalogs. */
    enabled: z.boolean().optional(),
    managedBy: ModelManagedBySchema.optional(),
    /** Remote official-catalog availability: 0 = available, 1 = unavailable. */
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    /** Current billing multiplier (for example 0.65 means 6.5折). */
    discount: z.number().finite().positive().max(1).optional(),
    /** Official input price in CNY per million tokens. */
    input: z.number().finite().nonnegative().optional(),
    /** Official output price in CNY per million tokens. */
    output: z.number().finite().nonnegative().optional(),
    /** Official cache price in CNY per million tokens. */
    cache: z.number().finite().nonnegative().optional()
  })
  .superRefine((value, context) => {
    if (!value.reasoning && value.defaultThinkingLevel !== "off") {
      context.addIssue({
        code: "custom",
        path: ["defaultThinkingLevel"],
        message:
          "A model without reasoning support must default thinking to off."
      });
    }
    if (
      value.reasoning &&
      !value.thinkingLevelOptions.includes(
        value.defaultThinkingLevel as ReasoningLevel
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultThinkingLevel"],
        message: "Default thinking level must be one of the configured options."
      });
    }
    if (
      (value.contextWindow === undefined) !==
      (value.maxTokens === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path:
          value.contextWindow === undefined ? ["contextWindow"] : ["maxTokens"],
        message:
          "Context window and max output tokens must be configured together."
      });
    }
    if (
      value.contextWindow !== undefined &&
      value.maxTokens !== undefined &&
      value.maxTokens > value.contextWindow
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxTokens"],
        message: "Max output tokens cannot exceed the context window."
      });
    }
  });

export const ModelConfigSchema = ModelIdentitySchema.and(
  z.object({
    hasApiKey: z.boolean()
  })
);
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelConfigInputSchema = ModelIdentitySchema.and(
  z.object({
    apiKey: z.string().trim().max(16_000).optional(),
    clearApiKey: z.boolean().optional()
  })
);
export type ModelConfigInput = z.infer<typeof ModelConfigInputSchema>;

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
    deepwriteFreeMessage: z.string().max(500).optional(),
    deepwriteOfficialModels: z.array(ModelConfigSchema).max(50).optional(),
    deepwriteOfficialEnabledModelIds: z
      .array(z.string().max(120))
      .max(50)
      .optional(),
    deepwriteOfficialTokenConfigured: z.boolean().optional()
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

export const OfficialModelBalanceSchema = z.object({
  queriedAt: z.string().min(1),
  accountBalance: z.number().int().nonnegative(),
  accountBalanceYuan: z.number().nonnegative(),
  keyQuotaRemaining: z.number().int().nonnegative(),
  keyQuotaRemainingYuan: z.number().nonnegative(),
  currentKeyRemaining: z.number().int().nonnegative().optional(),
  currentKeyRemainingYuan: z.number().nonnegative().optional(),
  currentKeyGranted: z.number().int().nonnegative().optional(),
  currentKeyGrantedYuan: z.number().nonnegative().optional(),
  currentKeyUsed: z.number().int().nonnegative().optional(),
  currentKeyUsedYuan: z.number().nonnegative().optional(),
  currentKeyUnlimited: z.boolean().optional(),
  usedQuota: z.number().int().nonnegative().optional(),
  usedYuan: z.number().nonnegative().optional(),
  quotaPerUnit: z.number().positive()
});
export type OfficialModelBalance = z.infer<typeof OfficialModelBalanceSchema>;

export const SiteOfficialQuotaSchema = z.object({
  queriedAt: z.string().datetime(),
  remaining: z.number().nonnegative().nullable(),
  used: z.number().nonnegative(),
  total: z.number().nonnegative().nullable(),
  unlimited: z.boolean()
});
export type SiteOfficialQuota = z.infer<typeof SiteOfficialQuotaSchema>;

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

export const AgentProviderRuntimeConfigSchema = ModelIdentitySchema.and(
  z.object({
    apiKey: z.string().max(16_000)
  })
);
export type AgentProviderRuntimeConfig = z.infer<
  typeof AgentProviderRuntimeConfigSchema
>;

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

export const ModelsRefreshOfficialCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.refreshOfficial"),
    payload: z.object({})
  });

export const ModelsQueryOfficialBalanceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.queryOfficialBalance"),
    payload: z.object({})
  });

export const ModelsSaveOfficialTokenCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.saveOfficialToken"),
    payload: z.object({
      apiKey: z.string().trim().min(1).max(16_000)
    })
  });

export const ModelsClearOfficialTokenCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.clearOfficialToken"),
    payload: z.object({})
  });

export const ModelsSaveSiteOfficialTokenCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.saveSiteOfficialToken"),
    payload: z.object({
      apiKey: z.string().trim().min(1).max(16_000)
    })
  });

export const ModelsClearSiteOfficialTokenCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.clearSiteOfficialToken"),
    payload: z.object({})
  });

export const ModelsRefreshSiteOfficialCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.refreshSiteOfficial"),
    payload: z.object({})
  });

export const ModelsQuerySiteOfficialQuotaCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.querySiteOfficialQuota"),
    payload: z.object({})
  });

export const ModelsSetSiteOfficialModelEnabledCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.setSiteOfficialModelEnabled"),
    payload: z.object({
      modelId: z.string().trim().min(1).max(120),
      enabled: z.boolean()
    })
  });

export const ModelsSetOfficialModelEnabledCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.setOfficialModelEnabled"),
    payload: z.object({
      modelId: z.string().trim().min(1).max(120),
      enabled: z.boolean()
    })
  });

export const ModelsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.save"),
  payload: ModelSettingsInputSchema
});

export const ModelsTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.test"),
  payload: z.object({ model: ModelConfigInputSchema })
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
  label: z.string().trim().min(1).max(240).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
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
  payload: z.object({ runtimeConfig: AgentProviderRuntimeConfigSchema })
});

export const AgentModelCapacityCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.model_capacity"),
    payload: z.object({ runtimeConfig: AgentProviderRuntimeConfigSchema })
  });
