import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { AgentUsageSchema } from "./agent-usage";
import { ModelManagedBySchema } from "./models";

export const MODEL_USAGE_MODULES = [
  "short-writing",
  "script-writing",
  "long-writing",
  "skill-library",
  "material-library",
  "learning-imitation",
  "long-book-analysis",
  "style-comparison",
  "subagent-authoring",
  "assistant-chat",
  "model-test",
  "unknown"
] as const;
export const ModelUsageModuleSchema = z.enum(MODEL_USAGE_MODULES);
export type ModelUsageModule = z.infer<typeof ModelUsageModuleSchema>;

export const MODEL_USAGE_ACTORS = [
  "main-agent",
  "subagent",
  "connection-test"
] as const;
export const ModelUsageActorSchema = z.enum(MODEL_USAGE_ACTORS);
export type ModelUsageActor = z.infer<typeof ModelUsageActorSchema>;

export const MODEL_USAGE_STATUSES = ["completed", "error", "aborted"] as const;
export const ModelUsageStatusSchema = z.enum(MODEL_USAGE_STATUSES);
export type ModelUsageStatus = z.infer<typeof ModelUsageStatusSchema>;

/**
 * A non-secret point-in-time model descriptor. This remains available after a
 * model is removed or its current configuration is changed.
 */
export const ModelUsageModelSnapshotSchema = z.object({
  configId: z.string().trim().min(1).max(120),
  revisionId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(240),
  api: z.string().trim().min(1).max(120).optional(),
  managedBy: ModelManagedBySchema.optional()
});
export type ModelUsageModelSnapshot = z.infer<
  typeof ModelUsageModelSnapshotSchema
>;

export const ModelUsageRecordSchema = z.object({
  id: z.string().trim().min(1).max(240),
  occurredAt: z.string().datetime(),
  model: ModelUsageModelSnapshotSchema,
  module: ModelUsageModuleSchema,
  actor: ModelUsageActorSchema,
  status: ModelUsageStatusSchema,
  usage: AgentUsageSchema
});
export type ModelUsageRecord = z.infer<typeof ModelUsageRecordSchema>;

export const ModelUsageQueryInputSchema = z
  .object({
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    modelConfigIds: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
    managedBy: ModelManagedBySchema.optional(),
    modules: z
      .array(ModelUsageModuleSchema)
      .max(MODEL_USAGE_MODULES.length)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.startAt &&
      value.endAt &&
      Date.parse(value.startAt) > Date.parse(value.endAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "endAt must not be earlier than startAt."
      });
    }
  });
export type ModelUsageQueryInput = z.infer<typeof ModelUsageQueryInputSchema>;

export const ModelUsageTotalsSchema = AgentUsageSchema.extend({
  requestCount: z.number().int().nonnegative()
});
export type ModelUsageTotals = z.infer<typeof ModelUsageTotalsSchema>;

export const ModelUsageTrendGranularitySchema = z.enum([
  "hour",
  "day",
  "month"
]);
export type ModelUsageTrendGranularity = z.infer<
  typeof ModelUsageTrendGranularitySchema
>;

export const ModelUsageTrendPointSchema = z.object({
  bucketStart: z.string().datetime(),
  totals: ModelUsageTotalsSchema
});
export type ModelUsageTrendPoint = z.infer<typeof ModelUsageTrendPointSchema>;

export const ModelUsageRecentCallSchema = ModelUsageRecordSchema.omit({
  id: true
});
export type ModelUsageRecentCall = z.infer<typeof ModelUsageRecentCallSchema>;

export const ModelUsageModelSummarySchema = z.object({
  model: ModelUsageModelSnapshotSchema,
  status: z.enum(["current", "historical", "faux"]),
  totals: ModelUsageTotalsSchema,
  firstUsedAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional()
});
export type ModelUsageModelSummary = z.infer<
  typeof ModelUsageModelSummarySchema
>;

export const ModelUsageModuleSummarySchema = z.object({
  module: ModelUsageModuleSchema,
  totals: ModelUsageTotalsSchema
});
export type ModelUsageModuleSummary = z.infer<
  typeof ModelUsageModuleSummarySchema
>;

export const ModelUsageDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  totals: ModelUsageTotalsSchema,
  trendGranularity: ModelUsageTrendGranularitySchema,
  trend: z.array(ModelUsageTrendPointSchema),
  models: z.array(ModelUsageModelSummarySchema),
  modules: z.array(ModelUsageModuleSummarySchema),
  recentCalls: z.array(ModelUsageRecentCallSchema).max(50)
});
export type ModelUsageDashboard = z.infer<typeof ModelUsageDashboardSchema>;

export const ModelUsageQueryCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("modelUsage.query"),
  payload: ModelUsageQueryInputSchema
});
