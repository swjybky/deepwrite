import type { Model } from "@earendil-works/pi-ai";

/** OpenAI metadata pending inclusion in the pinned PI model catalog. */
export const OPENAI_RUNTIME_MODELS = [
  {
    // Core capabilities from PI's unreleased GPT-6 Astra catalog entry:
    // https://github.com/earendil-works/pi/commit/17de82d7bea18a6589677a9761baabc2060c9efb
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    compat: {
      // This marks support for the flag, not a request to enable strict mode.
      // PI then emits strict:false for ordinary tools, keeping fields optional.
      supportsStrictMode: true
    },
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max"
    },
    input: ["text", "image"],
    // Managed-model billing comes from DeepWrite's remote catalog.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // The Codex model catalog exposes low through ultra for Sol. Pi carries
    // custom max/ultra values through xhigh at request time.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // Terra supports the same low-through-ultra reasoning range as Sol.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // Luna tops out at max; max is carried through Pi's xhigh slot.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "max"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">
] as const;
