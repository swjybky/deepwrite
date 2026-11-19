import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
  isDeepWriteSiteOfficialModel,
  type AgentProviderRuntimeConfig,
  type ModelApi
} from "@deepwrite/contracts";
import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { GEMINI_OPENAI_COMPLETIONS_COMPAT } from "./gemini-openai";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";
import { VOLCENGINE_COMPLETIONS_COMPAT } from "./volcengine-runtime";

type MetadataProvider = Parameters<typeof getBuiltinModels>[0];
type CompletionsProfile =
  "native" | "openai" | "gemini" | "volcengine" | "minimax";

interface SiteOfficialModelRoute {
  id: string;
  api: ModelApi;
  metadataProvider?: MetadataProvider;
  metadataModelId?: string;
  completionsProfile?: CompletionsProfile;
  thinkingLevelMap?: ThinkingLevelMap;
}

/**
 * Known official-site routes and native metadata for newly released models.
 * These are explicit metadata mappings, never substitutions for request IDs.
 * Prices, availability, enablement, endpoint and capacity overrides belong to
 * Main's remote model catalog. Keep credentials and origins out of this file.
 */
export const SITE_OFFICIAL_MODEL_ROUTES: readonly SiteOfficialModelRoute[] = [
  {
    id: "claude-opus-5-5",
    api: "anthropic-messages",
    metadataProvider: "anthropic"
  },
  {
    id: "claude-sonnet-5-5",
    api: "anthropic-messages",
    metadataProvider: "anthropic"
  },
  {
    id: "deepseek-flash",
    api: "openai-completions",
    metadataProvider: "deepseek",
    completionsProfile: "native"
  },
  {
    id: "doubao-seed-2-1-turbo-260628",
    api: "openai-completions",
    completionsProfile: "volcengine"
  },
  {
    id: "gemini-3.1-pro-low",
    api: "openai-completions",
    metadataProvider: "google",
    // Pi retains 3.1 Pro metadata under its preview ID. Only metadata is reused.
    metadataModelId: "gemini-3.1-pro-preview",
    completionsProfile: "gemini"
  },
  {
    id: "gemini-3.8-flash",
    api: "google-generative-ai",
    metadataProvider: "google"
  },
  {
    id: "gemini-3.8-flash-high",
    api: "openai-completions",
    metadataProvider: "google",
    metadataModelId: "gemini-3.8-flash",
    completionsProfile: "gemini"
  },
  {
    // Staged metadata; availability still comes from Main's remote catalog.
    id: "gemini-4-argon",
    api: "google-generative-ai",
    metadataProvider: "google"
  },
  {
    id: "glm-5.3-flash",
    api: "openai-completions",
    metadataProvider: "zai",
    completionsProfile: "native"
  },
  {
    id: "gpt-6-astra",
    api: "openai-completions",
    metadataProvider: "openai",
    completionsProfile: "openai"
  },
  {
    id: "gpt-6-astra-max",
    api: "openai-completions",
    metadataProvider: "openai",
    metadataModelId: "gpt-6-astra",
    completionsProfile: "openai"
  },
  {
    id: "gpt-6.1-sol",
    api: "openai-completions",
    metadataProvider: "openai",
    completionsProfile: "openai"
  },
  {
    id: "gpt-6.1-sol-max",
    api: "openai-completions",
    metadataProvider: "openai",
    metadataModelId: "gpt-6.1-sol",
    completionsProfile: "openai"
  },
  {
    id: "MiniMax-M3",
    api: "openai-completions",
    metadataProvider: "minimax",
    completionsProfile: "minimax"
  },
  {
    id: "qwen3.8-flash",
    api: "openai-completions",
    metadataProvider: "qwen-token-plan",
    completionsProfile: "openai",
    // The site uses OpenAI reasoning controls, not Coding Plan's enable_thinking.
    thinkingLevelMap: { off: null, low: "low", high: "xhigh", xhigh: "xhigh" }
  }
];

function completionsCompat(
  route: SiteOfficialModelRoute,
  source: Model<Api> | undefined
): Model<"openai-completions">["compat"] {
  const common = { supportsStore: false, supportsDeveloperRole: false };
  switch (route.completionsProfile) {
    case "gemini":
      return GEMINI_OPENAI_COMPLETIONS_COMPAT;
    case "volcengine":
      return VOLCENGINE_COMPLETIONS_COMPAT;
    case "minimax":
      return { ...common, maxTokensField: "max_tokens" };
    case "native":
      return {
        ...common,
        ...(source?.api === "openai-completions" ? source.compat : {}),
        ...(route.metadataProvider === "deepseek"
          ? { supportsStrictMode: false }
          : {})
      };
    default:
      // A Responses or Anthropic model behind /chat/completions must not inherit
      // its native protocol's tool-search, grammar, signature or beta flags.
      return { ...common, thinkingFormat: "openai" };
  }
}

export function findSiteOfficialRuntimeModel(
  config: AgentProviderRuntimeConfig
): Model<Api> | undefined {
  if (
    config.provider.trim().toLowerCase() !== "deepwrite-site" &&
    !isDeepWriteSiteOfficialModel(config)
  ) {
    return undefined;
  }
  const route = SITE_OFFICIAL_MODEL_ROUTES.find(
    (candidate) => candidate.id.toLowerCase() === config.modelId.toLowerCase()
  );
  // Honor changes in the remote declared protocol instead of silently rerouting.
  if (!route || route.api !== config.api) return undefined;
  const metadataModelId = route.metadataModelId ?? route.id;
  const source =
    (route.metadataProvider
      ? getBuiltinModels(route.metadataProvider).find(
          (model) => model.id === metadataModelId
        )
      : undefined) ?? findDeepWriteRuntimeModel(metadataModelId);
  const thinkingLevelMap = route.thinkingLevelMap ?? source?.thinkingLevelMap;
  const compat =
    route.api === "openai-completions"
      ? completionsCompat(route, source)
      : source?.api === route.api
        ? source.compat
        : undefined;
  return {
    id: route.id,
    name: route.id,
    provider: "deepwrite-site",
    api: route.api,
    // An official key must only be sent to Main's configured gateway.
    baseUrl: "",
    reasoning: source?.reasoning ?? true,
    input: source?.input ?? ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: source?.contextWindow ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: source?.maxTokens ?? DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
    ...(source?.inputLimits ? { inputLimits: source.inputLimits } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {})
  };
}
