import type {
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
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
  getBuiltinModels,
  getBuiltinProviders
} from "@earendil-works/pi-ai/providers/all";
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
import { findLongestModelIdBoundaryMatch } from "./model-id-matching";
import { enforceProviderToolSchemaCompatibility } from "./provider-tool-schema-compat";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";
import {
  appendDeepSeekWebSearchTool,
  assertDeepSeekWebSearchCompatible
} from "./deepseek-web-search";
import { applyGoogleClaudeThinkingCompatibility } from "./google-claude-thinking";

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

function findBuiltinModel(
  config: AgentProviderRuntimeConfig
): Model<Api> | undefined {
  const provider = getBuiltinProviders().find(
    (candidate) => candidate.toLowerCase() === config.provider.toLowerCase()
  );
  if (provider) {
    const model = findLongestModelIdBoundaryMatch(
      getBuiltinModels(provider),
      config.modelId
    ) as Model<Api> | undefined;
    if (model) return model;
  }
  return findDeepWriteRuntimeModel(config.modelId);
}

function resolveOpenAICompletionsCompat(
  config: AgentProviderRuntimeConfig,
  builtin: Model<Api> | undefined
): Model<"openai-completions">["compat"] | undefined {
  if (config.api !== "openai-completions") {
    return undefined;
  }

  const compat: NonNullable<Model<"openai-completions">["compat"]> = {
    ...(builtin?.api === "openai-completions" ? builtin.compat : {})
  };

  const provider = config.provider.toLowerCase();
  const baseUrl = config.baseUrl.toLowerCase();
  if (
    provider === "qwen" ||
    provider === "dashscope" ||
    (baseUrl.includes("dashscope") && baseUrl.includes("aliyuncs.com"))
  ) {
    compat.thinkingFormat = "qwen";
  } else if (
    provider === "zai" ||
    provider === "zhipu" ||
    baseUrl.includes("bigmodel.cn")
  ) {
    compat.thinkingFormat = "zai";
  }
  if (config.supportsDeveloperRole !== undefined) {
    compat.supportsDeveloperRole = config.supportsDeveloperRole;
  }
  return Object.keys(compat).length > 0 ? compat : undefined;
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
  streamFn: StreamFn;
  spawnStreamFn: StreamFn;
} {
  const parent = buildProviderRuntime(
    config,
    temperature,
    configuredThinkingLevel,
    compatibility
  );
  if (compatibility.webSearchEnabled !== true) {
    return { ...parent, spawnStreamFn: parent.streamFn };
  }
  const spawn = buildProviderRuntime(
    config,
    temperature,
    configuredThinkingLevel,
    { ...compatibility, webSearchEnabled: false }
  );
  return { ...parent, spawnStreamFn: spawn.streamFn };
}

/** @internal Exported for runtime-configuration regression tests. */
export function buildProviderRuntime(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel,
  compatibility: ProviderRuntimeCompatibilityOptions = {}
): {
  model: Model<Api>;
  streamFn: StreamFn;
} {
  if (compatibility.webSearchEnabled) {
    assertDeepSeekWebSearchCompatible(config);
  }
  const builtin = findBuiltinModel(config);
  const baseUrl =
    config.baseUrl || (builtin?.api === config.api ? builtin.baseUrl : "");
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
  const isOllamaProvider = isOllamaProviderName(config.provider);
  const streamFn = (
    requestModel: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => {
    const upstreamOnPayload = options?.onPayload;
    return streams.streamSimple(
      requestModel,
      applyProviderToolSchemaCompatibility(
        enforceProviderToolSchemaCompatibility(context),
        config.provider,
        config.toolSchemaProfile,
        compatibility.portableToolSchemaProfile
      ),
      applyGoogleClaudeThinkingCompatibility(config.api, requestModel.id, {
        ...options,
        ...(compatibility.webSearchEnabled
          ? {
              onPayload: async (payload: unknown, payloadModel: Model<Api>) => {
                const transformed = upstreamOnPayload
                  ? await upstreamOnPayload(payload, payloadModel)
                  : undefined;
                return appendDeepSeekWebSearchTool(
                  transformed === undefined ? payload : transformed,
                  config.api
                );
              }
            }
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
  return { model, streamFn: streamFn as StreamFn };
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
