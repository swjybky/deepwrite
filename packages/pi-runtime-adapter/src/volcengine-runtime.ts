import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { Model } from "@earendil-works/pi-ai";
import { findLongestModelIdBoundaryMatch } from "./model-id-matching";

export function isVolcengineProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === "volcengine" || normalized === "volcengine-plan";
}

// Ark accepts the same thinking.type / reasoning_effort shape as Pi's
// DeepSeek serializer. Keep this explicit: Pi 0.85 has no Ark provider.
export const VOLCENGINE_COMPLETIONS_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
  maxTokensField: "max_tokens",
  thinkingFormat: "deepseek"
} as const satisfies Model<"openai-completions">["compat"];

// Model IDs differ between the two routes. These capacities only apply to
// Coding Plan and follow Ark's published configuration.
// https://developer.volcengine.com/articles/7615528054736945158
const CODING_PLAN_MODELS = [
  { id: "ark-code-latest", maxTokens: 32_000 },
  { id: "doubao-seed-code", maxTokens: 32_000 },
  { id: "doubao-seed-2.0-code", maxTokens: 128_000 },
  { id: "doubao-seed-2.0-pro", maxTokens: 128_000 },
  { id: "doubao-seed-2.0-lite", maxTokens: 128_000 }
];

export function findVolcengineRuntimeModel(
  config: AgentProviderRuntimeConfig
): Model<"openai-completions"> | undefined {
  if (
    config.provider.trim().toLowerCase() !== "volcengine-plan" ||
    config.api !== "openai-completions"
  ) {
    return undefined;
  }
  const entry = findLongestModelIdBoundaryMatch(
    CODING_PLAN_MODELS,
    config.modelId
  );
  if (!entry) return undefined;
  return {
    id: entry.id,
    name: entry.id,
    provider: "volcengine-plan",
    api: "openai-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    compat: VOLCENGINE_COMPLETIONS_COMPAT,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: entry.maxTokens
  };
}
