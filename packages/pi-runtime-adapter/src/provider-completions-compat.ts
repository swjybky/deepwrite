import {
  isDeepWriteSiteOfficialModel,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  GEMINI_OPENAI_COMPLETIONS_COMPAT,
  isGeminiOpenAIConfig
} from "./gemini-openai";
import {
  isVolcengineProvider,
  VOLCENGINE_COMPLETIONS_COMPAT
} from "./volcengine-runtime";

const DEEPSEEK_MODEL_PATTERN = /(?:^|[/_.:-])deepseek(?:[-_.\d]|$)/iu;

function isDeepSeekModelId(modelId: string): boolean {
  return DEEPSEEK_MODEL_PATTERN.test(modelId);
}

function isDeepSeekHost(baseUrl: string): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/\.$/u, "");
    return host === "deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

function isDeepSeekCompletionsConfig(
  config: AgentProviderRuntimeConfig,
  builtin: Model<Api> | undefined,
  provider: string
): boolean {
  if (
    provider === "deepseek" ||
    isDeepSeekHost(config.baseUrl) ||
    builtin?.provider.toLowerCase() === "deepseek"
  ) {
    return true;
  }
  return (
    (provider === "deepwrite-site" || isDeepWriteSiteOfficialModel(config)) &&
    (isDeepSeekModelId(config.modelId) ||
      isDeepSeekModelId(config.requestModelId ?? ""))
  );
}

export function resolveOpenAICompletionsCompat(
  config: AgentProviderRuntimeConfig,
  builtin: Model<Api> | undefined
): Model<"openai-completions">["compat"] | undefined {
  if (config.api !== "openai-completions") {
    return undefined;
  }

  const compat: NonNullable<Model<"openai-completions">["compat"]> = {
    ...(isGeminiOpenAIConfig(config) ? GEMINI_OPENAI_COMPLETIONS_COMPAT : {}),
    ...(builtin?.api === "openai-completions" ? builtin.compat : {})
  };

  const provider = config.provider.trim().toLowerCase();
  const baseUrl = config.baseUrl.toLowerCase();
  if (isVolcengineProvider(provider)) {
    Object.assign(compat, VOLCENGINE_COMPLETIONS_COMPAT);
  } else if (
    provider === "qwen" ||
    provider === "dashscope" ||
    provider === "qwen-token-plan" ||
    (baseUrl.includes("dashscope") && baseUrl.includes("aliyuncs.com"))
  ) {
    compat.thinkingFormat = "qwen";
  } else if (
    provider === "zai" ||
    provider === "zhipu" ||
    baseUrl.includes("bigmodel.cn")
  ) {
    compat.thinkingFormat = "zai";
  } else if (provider === "modelscope" || baseUrl.includes("modelscope.cn")) {
    compat.supportsDeveloperRole = false;
  } else if (isDeepSeekCompletionsConfig(config, builtin, provider)) {
    // DeepSeek-compatible completions endpoints reject mixed strict and non-strict tools in one request.
    compat.supportsStrictMode = false;
  }
  if (config.supportsDeveloperRole !== undefined) {
    compat.supportsDeveloperRole = config.supportsDeveloperRole;
  }
  return Object.keys(compat).length > 0 ? compat : undefined;
}
