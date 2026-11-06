import { z } from "zod";

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

export const ToolSchemaProfileSchema = z.enum(["native", "portable"]);
export type ToolSchemaProfile = z.infer<typeof ToolSchemaProfileSchema>;

export const ModelManagedBySchema = z.enum(["deepwrite-free"]);
export type ModelManagedBy = z.infer<typeof ModelManagedBySchema>;

/**
 * Distinguishes text-generation models from JEV scoring/judgment models.
 * Absent or unknown values resolve to llm so existing configs stay compatible.
 */
export const MODEL_KINDS = ["llm", "jev"] as const;
export const ModelKindSchema = z.enum(MODEL_KINDS);
export type ModelKind = z.infer<typeof ModelKindSchema>;

export function resolveModelKind(model: {
  modelKind?: ModelKind | undefined;
}): ModelKind {
  return model.modelKind === "jev" ? "jev" : "llm";
}

export function isJevModel(model: {
  modelKind?: ModelKind | undefined;
}): boolean {
  return resolveModelKind(model) === "jev";
}

export function isTextGenerationModel(model: {
  modelKind?: ModelKind | undefined;
}): boolean {
  return resolveModelKind(model) === "llm";
}

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
    /** Optional catalog description displayed after the model name. */
    description: z.string().trim().max(500).optional(),
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
    /**
     * Optional model kind. Omit for legacy configs (treated as llm / 大模型).
     * `"jev"` marks scoring/judgment models configured on the custom-model page.
     */
    modelKind: ModelKindSchema.optional(),
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
    clearApiKey: z.boolean().optional(),
    sourceApiKeyId: z.string().trim().min(1).max(120).optional()
  })
);
export type ModelConfigInput = z.infer<typeof ModelConfigInputSchema>;

export const AgentProviderRuntimeConfigSchema = ModelIdentitySchema.and(
  z.object({
    apiKey: z.string().max(16_000)
  })
);
export type AgentProviderRuntimeConfig = z.infer<
  typeof AgentProviderRuntimeConfigSchema
>;
