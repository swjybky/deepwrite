import type {
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  type Api,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type ThinkingLevelMap
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
  type AgentProviderRuntimeConfig,
  type ThinkingLevel as ConfiguredThinkingLevel
} from "@deepwrite/contracts";
import {
  applyProviderToolSchemaCompatibility,
  isOllamaProviderName,
  type ProviderRuntimeCompatibilityOptions
} from "./portable-tool-schema";
import { findProviderModel } from "./provider-model-catalog";
import { enforceProviderToolSchemaCompatibility } from "./provider-tool-schema-compat";
import { applyGoogleClaudeThinkingCompatibility } from "./google-claude-thinking";
import { applyGeminiWritingSafetySettings } from "./gemini-safety";
import { createOpenCodeRequestHeaders } from "./opencode-request-headers";
import { createSiteSessionHeaders } from "./site-session-headers";
import {
  isGeminiOpenAIConfig,
  withGeminiOpenAIToolSignatures
} from "./gemini-openai";
import { resolveOpenAICompletionsCompat } from "./provider-completions-compat";

type ProviderStreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) => ReturnType<StreamFn>;

function providerStreams(
  api: AgentProviderRuntimeConfig["api"]
): ProviderStreams {
  if (api === "openai-completions") {
    return openAICompletionsApi();
  }
  if (api === "openai-responses") {
    return openAIResponsesApi();
  }
  if (api === "anthropic-messages") {
    return anthropicMessagesApi();
  }
  return googleGenerativeAIApi();
}

export function toPiThinkingLevel(
  level: ConfiguredThinkingLevel
): PiThinkingLevel {
  if (
    level === "off" ||
    level === "minimal" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh"
  ) {
    return level;
  }
  // Pi exposes five reasoning carriers. The model-level map below rewrites the
  // xhigh carrier to max or to the user's provider-specific custom value.
  return "xhigh";
}

export function buildWorkspaceProviderRuntimes(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel,
  compatibility: ProviderRuntimeCompatibilityOptions = {}
): {
  model: Model<Api>;
  streamFn: ProviderStreamFn;
  spawnStreamFn: ProviderStreamFn;
} {
  const runtime = buildProviderRuntime(
    config,
    temperature,
    configuredThinkingLevel,
    compatibility
  );
  return { ...runtime, spawnStreamFn: runtime.streamFn };
}

/** @internal Exported for runtime-configuration regression tests. */
export function buildProviderRuntime(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel,
  compatibility: ProviderRuntimeCompatibilityOptions = {}
): {
  model: Model<Api>;
  streamFn: ProviderStreamFn;
} {
  const builtin = findProviderModel(config);
  const configuredBaseUrl =
    config.baseUrl || (builtin?.api === config.api ? builtin.baseUrl : "");
  // Anthropic's SDK appends /v1/messages itself; saved gateway URLs often
  // already include /v1, unlike the SDK's expected unversioned base URL.
  const baseUrl =
    config.api === "anthropic-messages"
      ? configuredBaseUrl.replace(/\/v1\/?$/u, "")
      : configuredBaseUrl;
  if (!baseUrl) {
    throw new Error("当前模型不在 Pi 内置目录中，请填写 API 地址后再试。");
  }
  const effectiveTemperature =
    configuredThinkingLevel === "off" &&
    builtin?.reasoning === true &&
    builtin.thinkingLevelMap?.off === null
      ? undefined
      : temperature;
  const requestModelId = config.requestModelId ?? config.modelId;

  const thinkingLevelMap: ThinkingLevelMap = {
    ...(builtin?.thinkingLevelMap ?? {})
  };
  const compat = resolveOpenAICompletionsCompat(config, builtin);
  // Pi's Z.AI serializer emits `thinking: disabled` whenever reasoning is
  // absent, even when the catalog marks off as unsupported. GLM-5.3 rejects
  // that payload, so stale/off run settings must degrade to its lowest valid
  // effort instead of attempting to disable mandatory thinking.
  const mandatoryZaiThinkingFallback =
    configuredThinkingLevel === "off" &&
    builtin?.thinkingLevelMap?.off === null &&
    compat?.thinkingFormat === "zai"
      ? "low"
      : undefined;
  if (configuredThinkingLevel && configuredThinkingLevel !== "off") {
    const carrier = toPiThinkingLevel(configuredThinkingLevel);
    if (configuredThinkingLevel !== carrier) {
      thinkingLevelMap[carrier] = configuredThinkingLevel;
    } else if (carrier === "xhigh" && thinkingLevelMap.xhigh === undefined) {
      thinkingLevelMap.xhigh = "xhigh";
    }
  }
  const model = {
    ...(builtin?.api === config.api ? builtin : {}),
    id: requestModelId,
    name: config.label,
    api: config.api,
    provider: config.provider,
    baseUrl,
    // `reasoning` describes a model capability to pi-ai; it is not the
    // per-request switch. Keep that capability enabled while a run selects
    // "off" so pi-ai can serialize the provider-specific disable control
    // (`thinking: disabled`, `enable_thinking: false`, thinkingBudget: 0,
    // etc.). For catalog models, retain the catalog's known capability.
    // Unknown/custom models are treated as capable: compatible providers can
    // honor the control, while providers without a control simply omit it.
    reasoning: builtin?.reasoning ?? true,
    // A custom endpoint has no Pi catalog metadata. Keep image blocks enabled
    // and let that endpoint return an explicit capability error if its selected
    // model is text-only; silently dropping a user image is never acceptable.
    input: builtin?.input ?? ["text", "image"],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Unknown routes inherit the GPT-5.6 Sol capacity baseline so a missing
    // catalog entry does not unnecessarily constrain long-form writing runs.
    // A saved custom-model override always wins over catalog and baseline.
    contextWindow:
      config.contextWindow ??
      builtin?.contextWindow ??
      DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens:
      config.maxTokens ?? builtin?.maxTokens ?? DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
    ...(builtin?.headers ? { headers: builtin.headers } : {}),
    ...(Object.keys(thinkingLevelMap).length > 0 ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {})
  } as Model<Api>;
  const streams = providerStreams(config.api);
  const openCodeRequestHeaders = createOpenCodeRequestHeaders({
    provider: config.provider,
    baseUrl
  });
  const siteSessionHeaders = createSiteSessionHeaders(config);
  const isOllamaProvider = isOllamaProviderName(config.provider);
  const streamFn = (
    requestModel: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => {
    const openCodeHeaders = openCodeRequestHeaders(options?.sessionId);
    const sessionHeaders = siteSessionHeaders(options?.sessionId);
    const requestHeaders =
      openCodeHeaders || sessionHeaders
        ? { ...openCodeHeaders, ...sessionHeaders }
        : undefined;
    return streams.streamSimple(
      requestModel,
      normalizeContext(
        applyProviderToolSchemaCompatibility(
          enforceProviderToolSchemaCompatibility(context),
          config.provider,
          config.toolSchemaProfile,
          compatibility.portableToolSchemaProfile
        )
      ),
      applyGoogleClaudeThinkingCompatibility(config.api, requestModel.id, {
        ...applyGeminiWritingSafetySettings(config, options ?? {}),
        ...(requestHeaders
          ? { headers: { ...options?.headers, ...requestHeaders } }
          : {}),
        ...(mandatoryZaiThinkingFallback
          ? { reasoning: mandatoryZaiThinkingFallback }
          : {}),
        ...(effectiveTemperature !== undefined
          ? { temperature: effectiveTemperature }
          : {}),
        ...(config.apiKey
          ? { apiKey: config.apiKey }
          : isOllamaProvider
            ? { apiKey: "ollama" }
            : options?.apiKey
              ? { apiKey: options.apiKey }
              : {})
      })
    );
  };
  return {
    model,
    streamFn: isGeminiOpenAIConfig(config)
      ? withGeminiOpenAIToolSignatures(streamFn)
      : streamFn
  };
}

export function resolveProviderModelCapacity(
  config: AgentProviderRuntimeConfig
): { contextWindow: number; maxTokens: number } {
  const { model } = buildProviderRuntime(
    config,
    undefined,
    config.defaultThinkingLevel
  );
  return {
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  };
}
