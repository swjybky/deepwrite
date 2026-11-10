import { z } from "zod";
import type { ModelConfig } from "../model-configuration";
import { isDeepWriteSiteOfficialModel } from "../model-configuration";

/**
 * Search providers behind the `web_search` tool. Adding one means a new ID and
 * descriptor here, a profile member in `settings.ts` and a client in the Pi
 * adapter; `satisfies Record<…>` keeps each table complete.
 */
export const WEB_SEARCH_PROVIDER_IDS = [
  "deepseek",
  "tavily",
  "exa",
  "brave",
  "serper",
  "serpapi",
  "searchapi",
  "bocha",
  "zhipu",
  "search1api",
  "searxng"
] as const;
export const WebSearchProviderIdSchema = z.enum(WEB_SEARCH_PROVIDER_IDS);
export type WebSearchProviderId = z.infer<typeof WebSearchProviderIdSchema>;

export const DEFAULT_WEB_SEARCH_PROVIDER_ID: WebSearchProviderId = "deepseek";

/** Which saved custom models may lend their API key to a search provider. */
export interface WebSearchKeyImportRule {
  /** Model `provider` values; compared after trim and lower-casing. */
  modelProviders: readonly string[];
  /** Exact host names of the model `baseUrl`; an empty URL never matches. */
  baseUrlHosts: readonly string[];
}

export interface WebSearchProviderDescriptor {
  id: WebSearchProviderId;
  /** Default service address; a saved profile may select a compatible endpoint. */
  defaultBaseUrl: string;
  /** Most results one call may ask for, whatever the service itself allows. */
  maxResultsCap: number;
  defaultMaxResults: number;
  queryMaxChars: number;
  /** Whether the provider can read one page's text, which mounts `web_fetch`. */
  supportsFetch: boolean;
  /** Longest address `web_fetch` sends; only meaningful with `supportsFetch`. */
  fetchUrlMaxChars: number;
  keyImport?: WebSearchKeyImportRule;
  /** Self-hosted services may work without an API key. Defaults to true. */
  requiresApiKey?: boolean;
}

export const WEB_SEARCH_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com",
    maxResultsCap: 20,
    defaultMaxResults: 8,
    queryMaxChars: 128,
    supportsFetch: true,
    fetchUrlMaxChars: 8192,
    keyImport: {
      modelProviders: ["deepseek"],
      baseUrlHosts: ["api.deepseek.com"]
    }
  },
  tavily: {
    id: "tavily",
    defaultBaseUrl: "https://api.tavily.com",
    maxResultsCap: 20,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  exa: {
    id: "exa",
    defaultBaseUrl: "https://api.exa.ai",
    maxResultsCap: 50,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  brave: {
    id: "brave",
    defaultBaseUrl: "https://api.search.brave.com",
    maxResultsCap: 20,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  serper: {
    id: "serper",
    defaultBaseUrl: "https://google.serper.dev",
    maxResultsCap: 10,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  serpapi: {
    id: "serpapi",
    defaultBaseUrl: "https://serpapi.com",
    maxResultsCap: 10,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  searchapi: {
    id: "searchapi",
    defaultBaseUrl: "https://www.searchapi.io",
    maxResultsCap: 10,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  bocha: {
    id: "bocha",
    defaultBaseUrl: "https://api.bocha.cn",
    maxResultsCap: 50,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  zhipu: {
    id: "zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn",
    maxResultsCap: 50,
    defaultMaxResults: 8,
    queryMaxChars: 70,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  search1api: {
    id: "search1api",
    defaultBaseUrl: "https://api.search1api.com",
    maxResultsCap: 50,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  },
  searxng: {
    id: "searxng",
    defaultBaseUrl: "",
    maxResultsCap: 50,
    defaultMaxResults: 8,
    queryMaxChars: 400,
    requiresApiKey: false,
    supportsFetch: false,
    fetchUrlMaxChars: 0
  }
} as const satisfies Record<WebSearchProviderId, WebSearchProviderDescriptor>;

export function webSearchProvider(
  id: WebSearchProviderId
): WebSearchProviderDescriptor {
  return WEB_SEARCH_PROVIDERS[id];
}

export type WebSearchKeyImportModel = Pick<
  ModelConfig,
  "id" | "provider" | "baseUrl" | "hasApiKey"
> & { managedBy?: ModelConfig["managedBy"] | undefined };

/**
 * Whether a saved model qualifies as a key source. Pure: it never sees the
 * key itself, only whether one is saved.
 */
export function matchesWebSearchKeyImport(
  model: WebSearchKeyImportModel,
  rule: WebSearchKeyImportRule
): boolean {
  if (
    !model.hasApiKey ||
    model.managedBy ||
    isDeepWriteSiteOfficialModel(model)
  )
    return false;
  const provider = model.provider.trim().toLowerCase();
  if (!rule.modelProviders.some((entry) => entry.toLowerCase() === provider))
    return false;
  if (!model.baseUrl) return false;
  let host: string;
  try {
    host = new URL(model.baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return rule.baseUrlHosts.some((entry) => entry.toLowerCase() === host);
}
