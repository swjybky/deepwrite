import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const ModelApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
]);
export type ModelApi = z.infer<typeof ModelApiSchema>;

const ModelIdentitySchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(240),
  api: ModelApiSchema,
  baseUrl: z.union([z.literal(""), z.url().max(2_000)]),
  reasoning: z.boolean(),
  defaultThinkingLevel: ThinkingLevelSchema
}).superRefine((value, context) => {
  if (!value.reasoning && value.defaultThinkingLevel !== "off") {
    context.addIssue({
      code: "custom",
      path: ["defaultThinkingLevel"],
      message: "A model without reasoning support must default thinking to off."
    });
  }
});

export const ModelConfigSchema = ModelIdentitySchema.and(z.object({
  hasApiKey: z.boolean()
}));
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelConfigInputSchema = ModelIdentitySchema.and(z.object({
  apiKey: z.string().trim().max(16_000).optional(),
  clearApiKey: z.boolean().optional()
}));
export type ModelConfigInput = z.infer<typeof ModelConfigInputSchema>;

export const ModelSettingsSchema = z.object({
  models: z.array(ModelConfigSchema).max(50),
  defaultModelId: z.string().max(120)
}).superRefine((value, context) => {
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

export const ModelSettingsInputSchema = z.object({
  models: z.array(ModelConfigInputSchema).max(50),
  defaultModelId: z.string().max(120)
}).superRefine((value, context) => {
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

export const AgentProviderRuntimeConfigSchema = ModelIdentitySchema.and(z.object({
  apiKey: z.string().max(16_000)
}));
export type AgentProviderRuntimeConfig = z.infer<typeof AgentProviderRuntimeConfigSchema>;

export const ModelConnectionTestResultSchema = z.object({
  modelId: z.string().min(1),
  ok: z.boolean(),
  message: z.string().min(1),
  testedAt: z.string().datetime()
});
export type ModelConnectionTestResult = z.infer<typeof ModelConnectionTestResultSchema>;

export const ModelsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.list"),
  payload: z.object({})
});

export const ModelsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.save"),
  payload: ModelSettingsInputSchema
});

export const ModelsTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("models.test"),
  payload: z.object({ modelId: z.string().min(1).max(120) })
});

export const AgentModelTestCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.model_test"),
  payload: z.object({ runtimeConfig: AgentProviderRuntimeConfigSchema })
});
