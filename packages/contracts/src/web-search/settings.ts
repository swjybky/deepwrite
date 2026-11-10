import { z } from "zod";
import {
  DEFAULT_WEB_SEARCH_PROVIDER_ID,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_IDS,
  webSearchProvider,
  WebSearchProviderIdSchema
} from "./providers";

export const WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN = 1;
export const WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX = 100;
export const WEB_SEARCH_DEFAULT_PER_RUN_CALL_LIMIT = 20;
export const WEB_SEARCH_API_KEY_MAX_LENGTH = 16_000;
/** Hard ceiling of a runtime config, above every provider's own cap. */
export const WEB_SEARCH_RUNTIME_MAX_RESULTS = 50;

const ModelIdSchema = z.string().trim().min(1).max(120);

/** Where the saved key came from; informational, never grants anything. */
export const WebSearchKeySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({
    kind: z.literal("model"),
    modelId: ModelIdSchema,
    modelLabel: z.string().trim().min(1).max(120),
    importedAt: z.string().datetime()
  })
]);
export type WebSearchKeySource = z.infer<typeof WebSearchKeySourceSchema>;

/** Tunable, non-secret parameters of each provider. */
export const WebSearchBaseUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "接口地址需为 HTTPS 地址（本机可用 HTTP），不能包含账号、查询参数或片段。");

function paramsShape<Id extends (typeof WEB_SEARCH_PROVIDER_IDS)[number]>(
  id: Id
) {
  return {
    providerId: z.literal(id),
    baseUrl: WebSearchBaseUrlSchema.optional(),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(WEB_SEARCH_PROVIDERS[id].maxResultsCap)
  };
}

/**
 * Profiles that cross the process boundary are strict, so a response or input
 * carrying a stray field (a key, say) is rejected rather than quietly dropped.
 * Extend the member list here, and in the stored schema below, for a new
 * provider.
 */
function profileSchema<Extra extends z.ZodRawShape>(extra: Extra) {
  return z.discriminatedUnion("providerId", [
    z.strictObject({ ...paramsShape("deepseek"), ...extra }),
    z.strictObject({ ...paramsShape("tavily"), ...extra }),
    z.strictObject({ ...paramsShape("exa"), ...extra }),
    z.strictObject({ ...paramsShape("brave"), ...extra }),
    z.strictObject({ ...paramsShape("serper"), ...extra }),
    z.strictObject({ ...paramsShape("serpapi"), ...extra }),
    z.strictObject({ ...paramsShape("searchapi"), ...extra }),
    z.strictObject({ ...paramsShape("bocha"), ...extra }),
    z.strictObject({ ...paramsShape("zhipu"), ...extra }),
    z.strictObject({ ...paramsShape("search1api"), ...extra }),
    z.strictObject({ ...paramsShape("searxng"), ...extra })
  ]);
}

export const WebSearchProfileParamsSchema = profileSchema({});
export type WebSearchProfileParams = z.infer<
  typeof WebSearchProfileParamsSchema
>;

/**
 * Profile as saved on disk: no key material and no derived fields. Lenient on
 * unknown fields, so a file written by a newer version still opens.
 */
export const WebSearchStoredProfileSchema = z.discriminatedUnion("providerId", [
  z.object({
    ...paramsShape("deepseek"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("tavily"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("exa"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("brave"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("serper"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("serpapi"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("searchapi"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("bocha"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("zhipu"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("search1api"),
    keySource: WebSearchKeySourceSchema.optional()
  }),
  z.object({
    ...paramsShape("searxng"),
    keySource: WebSearchKeySourceSchema.optional()
  })
]);
export type WebSearchStoredProfile = z.infer<
  typeof WebSearchStoredProfileSchema
>;

export const WebSearchProfileSchema = profileSchema({
  hasApiKey: z.boolean(),
  keySource: WebSearchKeySourceSchema.optional()
});
export type WebSearchProfile = z.infer<typeof WebSearchProfileSchema>;

export const WebSearchProfileInputSchema = profileSchema({
  apiKey: z.string().trim().max(WEB_SEARCH_API_KEY_MAX_LENGTH).optional(),
  clearApiKey: z.boolean().optional()
});
export type WebSearchProfileInput = z.infer<typeof WebSearchProfileInputSchema>;

const PerRunCallLimitSchema = z
  .number()
  .int()
  .min(WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN)
  .max(WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX);

function uniqueProviders(
  value: { profiles: { providerId: string }[] },
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = value.profiles.map((profile) => profile.providerId);
  if (ids.length !== new Set(ids).size)
    context.addIssue({
      code: "custom",
      path: ["profiles"],
      message: "联网搜索配置的搜索源不能重复。"
    });
}

const maxProfiles = WEB_SEARCH_PROVIDER_IDS.length;

export const WebSearchStoredSettingsSchema = z
  .object({
    enabled: z.boolean(),
    activeProviderId: WebSearchProviderIdSchema,
    perRunCallLimit: PerRunCallLimitSchema,
    profiles: z.array(WebSearchStoredProfileSchema).max(maxProfiles)
  })
  .superRefine(uniqueProviders);
export type WebSearchStoredSettings = z.infer<
  typeof WebSearchStoredSettingsSchema
>;

/** Settings as the Renderer sees them: one profile per known provider. */
export const WebSearchSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    activeProviderId: WebSearchProviderIdSchema,
    perRunCallLimit: PerRunCallLimitSchema,
    profiles: z.array(WebSearchProfileSchema).max(maxProfiles)
  })
  .superRefine(uniqueProviders);
export type WebSearchSettings = z.infer<typeof WebSearchSettingsSchema>;

/**
 * Whether a run can be given search: it is on and the active provider has an
 * endpoint and any required key. Main resolves the same condition, so a session switch is only offered
 * while it could take effect.
 */
export function isWebSearchUsable(
  settings: Pick<WebSearchSettings, "enabled" | "activeProviderId" | "profiles">
): boolean {
  return (
    settings.enabled &&
    settings.profiles.some(
      (profile) =>
        profile.providerId === settings.activeProviderId &&
        Boolean(
          profile.baseUrl ||
          webSearchProvider(profile.providerId).defaultBaseUrl
        ) &&
        (profile.hasApiKey ||
          webSearchProvider(profile.providerId).requiresApiKey === false)
    )
  );
}

/**
 * Providers left out of the input keep their saved profile, so a client that
 * only knows some providers never deletes another one's key.
 */
export const WebSearchSettingsInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    activeProviderId: WebSearchProviderIdSchema,
    perRunCallLimit: PerRunCallLimitSchema,
    profiles: z.array(WebSearchProfileInputSchema).max(maxProfiles)
  })
  .superRefine(uniqueProviders);
export type WebSearchSettingsInput = z.infer<
  typeof WebSearchSettingsInputSchema
>;

export const DEFAULT_WEB_SEARCH_STORED_SETTINGS: WebSearchStoredSettings = {
  enabled: true,
  activeProviderId: DEFAULT_WEB_SEARCH_PROVIDER_ID,
  perRunCallLimit: WEB_SEARCH_DEFAULT_PER_RUN_CALL_LIMIT,
  profiles: []
};

/**
 * What Main hands the Agent Utility for one run. Runtime only: it carries the
 * key, so it is never saved and never sent to the Renderer.
 */
export const WebSearchRuntimeConfigSchema = z
  .object({
    providerId: WebSearchProviderIdSchema,
    baseUrl: z.url().max(2_000),
    apiKey: z.string().max(WEB_SEARCH_API_KEY_MAX_LENGTH),
    maxResults: z.number().int().min(1).max(WEB_SEARCH_RUNTIME_MAX_RESULTS),
    perRunCallLimit: PerRunCallLimitSchema
  })
  .refine(
    (config) =>
      config.apiKey.length > 0 ||
      webSearchProvider(config.providerId).requiresApiKey === false,
    { path: ["apiKey"], message: "搜索服务需要 API Key。" }
  );
export type WebSearchRuntimeConfig = z.infer<
  typeof WebSearchRuntimeConfigSchema
>;
