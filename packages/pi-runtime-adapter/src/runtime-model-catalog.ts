import type { Api, Model } from "@earendil-works/pi-ai";
import { findLongestModelIdBoundaryMatch } from "./model-id-matching";
import { OPENAI_RUNTIME_MODELS } from "./runtime-model-catalog-openai";

/**
 * Runtime model metadata that DeepWrite needs before the pinned pi-ai catalog
 * has caught up with a newly released model.
 *
 * Keep endpoint credentials and user-facing enablement out of this catalog.
 * A configured model still supplies its own provider, base URL, label, and key.
 */
const DEEPWRITE_RUNTIME_MODELS = [
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
      supportsStrictMode: true
    },
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "high",
      medium: "high",
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000
  } satisfies Model<"openai-completions">,
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
      supportsStrictMode: true
    },
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "high",
      medium: "high",
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000
  } satisfies Model<"openai-completions">,
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision Exp",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
      supportsStrictMode: true
    },
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "high",
      medium: "high",
      high: "high",
      xhigh: "max"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000
  } satisfies Model<"openai-completions">,
  {
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash 0731",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek"
    },
    reasoning: true,
    // The 0731 release is the production DeepSeek V4 Flash checkpoint and
    // keeps the same reasoning controls as the Pi catalog's unversioned model.
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    // Managed-model billing comes from DeepWrite's remote catalog.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000
  } satisfies Model<"openai-completions">,
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "zai",
      supportsStrictMode: true,
      zaiToolStream: true
    },
    reasoning: true,
    // GLM-5.3 always thinks and accepts exactly low / high / max. Pi carries
    // the provider's max value through its xhigh reasoning slot.
    thinkingLevelMap: {
      off: null,
      low: "low",
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "zai",
      supportsStrictMode: true,
      zaiToolStream: true
    },
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "high",
      medium: "high",
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "qwen3.7-plus",
    name: "Qwen3.7 Plus",
    api: "openai-completions",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      low: "low",
      high: "xhigh",
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    api: "openai-responses",
    provider: "xai",
    baseUrl: "https://api.x.ai/v1",
    compat: {
      supportsLongCacheRetention: false
    },
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 500_000,
    maxTokens: 500_000
  } satisfies Model<"openai-responses">,
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    api: "openai-responses",
    provider: "xai",
    baseUrl: "https://api.x.ai/v1",
    compat: {
      supportsLongCacheRetention: false
    },
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Grok 4.6 retains the 500K capacity of Grok 4.5. Keeping this explicit
    // prevents custom gateways from falling back to DeepWrite's 272K/128K
    // unknown-model baseline while upstream catalogs catch up.
    contextWindow: 500_000,
    maxTokens: 500_000
  } satisfies Model<"openai-responses">,
  ...OPENAI_RUNTIME_MODELS,
  {
    id: "kimi-k3",
    name: "Kimi K3",
    api: "openai-completions",
    provider: "moonshotai",
    baseUrl: "https://api.moonshot.ai/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // K3 always thinks. Pi represents an unsupported off switch with null;
    // max is carried through Pi's xhigh slot and serialized as "max".
    thinkingLevelMap: {
      off: null,
      low: "low",
      high: "high",
      xhigh: "max"
    },
    input: ["text", "image"],
    // Billing for managed models is calculated from DeepWrite's remote
    // catalog, not from pi-ai's USD-denominated model metadata.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    // Kimi documents 131072 as the default completion limit. The API permits
    // callers to raise it further, but DeepWrite does not expose that control.
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "qwen3.8-max",
    name: "Qwen3.8 Max",
    api: "openai-completions",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // Qwen3.8 uses low / medium / xhigh. The public catalog exposes
    // low / high / max, so high is promoted to xhigh; max is accepted by the
    // API as an OpenAI-compatible alias for xhigh. `none` disables thinking.
    thinkingLevelMap: {
      off: "none",
      low: "low",
      high: "xhigh",
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 983_616,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "qwen3.8-max-preview",
    name: "Qwen3.8 Max Preview",
    api: "openai-completions",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // Preview is thinking-only. A null off mapping tells Pi not to serialize
    // a false disable control that this model cannot honor.
    thinkingLevelMap: {
      off: null,
      low: "low",
      high: "xhigh",
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 983_616,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">
] as const;

export function findDeepWriteRuntimeModel(
  modelId: string
): Model<Api> | undefined {
  return findLongestModelIdBoundaryMatch(DEEPWRITE_RUNTIME_MODELS, modelId) as
    Model<Api> | undefined;
}
