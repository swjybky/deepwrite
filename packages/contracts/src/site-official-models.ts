import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const SiteOfficialQuotaSchema = z.object({
  queriedAt: z.string().datetime(),
  remaining: z.number().nonnegative().nullable(),
  used: z.number().nonnegative(),
  total: z.number().nonnegative().nullable(),
  unlimited: z.boolean(),
  targetRevision: z.string().uuid().optional()
});
export type SiteOfficialQuota = z.infer<typeof SiteOfficialQuotaSchema>;

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

export const SiteOfficialQuotaMergeInputSchema = z.object({
  sourceKey: z.string().trim().min(1).max(1_024),
  targetRevision: z.string().uuid()
});
export type SiteOfficialQuotaMergeInput = z.infer<
  typeof SiteOfficialQuotaMergeInputSchema
>;

export const SiteOfficialQuotaMergeResultSchema = z.object({
  transferred: z.string().regex(/^\d+(?:\.\d+)?$/),
  sourceRevoked: z.literal(true),
  quota: SiteOfficialQuotaSchema
});
export type SiteOfficialQuotaMergeResult = z.infer<
  typeof SiteOfficialQuotaMergeResultSchema
>;

export const ModelsMergeSiteOfficialQuotaCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("models.mergeSiteOfficialQuota"),
    payload: SiteOfficialQuotaMergeInputSchema
  });

export const SiteOfficialModelCommandSchemas = [
  ModelsSaveSiteOfficialTokenCommandEnvelopeSchema,
  ModelsClearSiteOfficialTokenCommandEnvelopeSchema,
  ModelsRefreshSiteOfficialCommandEnvelopeSchema,
  ModelsQuerySiteOfficialQuotaCommandEnvelopeSchema,
  ModelsSetSiteOfficialModelEnabledCommandEnvelopeSchema,
  ModelsMergeSiteOfficialQuotaCommandEnvelopeSchema
] as const;

// HTTP contract shared with POST /v1/key/quota/merge. Keep decimal strings
// intact at the boundary; numeric conversion is only for the existing UI.
const YuanDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
export const SiteOfficialQuotaMergeResponseSchema = z.object({
  object: z.literal("api_key_quota_merge"),
  currency: z.literal("CNY"),
  transferred: YuanDecimalSchema,
  source_revoked: z.literal(true),
  quota: z.object({
    object: z.literal("api_key_quota"),
    currency: z.literal("CNY"),
    queried_at: z.string().datetime({ offset: true }),
    status: z.enum(["active", "exhausted"]),
    unlimited: z.literal(false),
    total: YuanDecimalSchema,
    used: YuanDecimalSchema,
    remaining: YuanDecimalSchema,
    expires_at: z.string().datetime({ offset: true }).optional()
  })
});
