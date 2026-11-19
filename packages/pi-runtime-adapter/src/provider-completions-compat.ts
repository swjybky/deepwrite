import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  GEMINI_OPENAI_COMPLETIONS_COMPAT,
  isGeminiOpenAIConfig
} from "./gemini-openai";
import {
  isVolcengineProvider,
  VOLCENGINE_COMPLETIONS_COMPAT
} from "./volcengine-runtime";

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

  const provider = config.provider.toLowerCase();
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
  }
  if (config.supportsDeveloperRole !== undefined) {
    compat.supportsDeveloperRole = config.supportsDeveloperRole;
  }
  return Object.keys(compat).length > 0 ? compat : undefined;
}
