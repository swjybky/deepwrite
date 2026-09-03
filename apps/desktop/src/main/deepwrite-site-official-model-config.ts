import { createHash } from "node:crypto";
import {
  DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX,
  ModelConfigInputSchema,
  isDeepWriteSiteOfficialModel,
  type ModelApi,
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type RemoteModelListItem
} from "@deepwrite/contracts";
import { DEEPWRITE_PUBLIC_DATA_API_BASE_URL } from "./deepwrite-public-data-config";

export const DEEPWRITE_SITE_OFFICIAL_MODEL_ID =
  "deepwrite-site-official-deepseek-v4-flash";

export interface DeepWriteSiteOfficialRemoteCatalog {
  models: RemoteModelListItem[];
  googleModels: RemoteModelListItem[];
}

interface KnownModelDefaults {
  label: string;
  provider: string;
  reasoning: boolean;
  thinkingLevelOptions: ModelConfigInput["thinkingLevelOptions"];
  input?: number;
  output?: number;
  cache?: number;
}

const KNOWN_MODEL_DEFAULTS: Record<string, KnownModelDefaults> = {
  "deepseek-v4-flash": {
    label: "DeepSeek-V4-Flash",
    provider: "deepseek",
    reasoning: true,
    thinkingLevelOptions: ["low", "high", "max"],
    input: 3,
    output: 6,
    cache: 0.25
  },
  "gemini-3.7-flash": {
    label: "Gemini-3.7-Flash",
    provider: "google",
    reasoning: true,
    thinkingLevelOptions: ["low", "medium", "high"],
    input: 1,
    output: 3,
    cache: 0.05
  }
};

function gatewayRootUrl(rawBaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error("新官方小站模型接口地址无效。");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith(".invalid")
  ) {
    throw new Error("新官方小站模型接口地址无效。");
  }
  parsed.pathname = parsed.pathname
    .replace(/\/(?:v1|v1beta)\/?$/u, "")
    .replace(/\/+$/u, "");
  return parsed;
}

export function deepWriteSiteOfficialGatewayBaseUrl(
  api: "openai-completions" | "google-generative-ai",
  rawBaseUrl = DEEPWRITE_PUBLIC_DATA_API_BASE_URL
): string {
  const root = gatewayRootUrl(rawBaseUrl);
  const version = api === "google-generative-ai" ? "v1beta" : "v1";
  const pathname = root.pathname === "/" ? "" : root.pathname;
  return `${root.origin}${pathname}/${version}`;
}

function toInput(model: ModelConfig): ModelConfigInput {
  const { hasApiKey: _hasApiKey, ...identity } = model;
  return identity;
}

function configId(modelId: string): string {
  if (/^[a-z0-9._-]+$/iu.test(modelId)) {
    const candidate = `${DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX}${modelId.toLowerCase()}`;
    if (candidate.length <= 120) return candidate;
  }
  const suffix = createHash("sha256").update(modelId, "utf8").digest("hex");
  return `${DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX}${suffix.slice(0, 32)}`;
}

function inferredProvider(modelId: string, api: ModelApi): string {
  if (api === "google-generative-ai") return "google";
  if (/^deepseek(?:[-_.]|$)/iu.test(modelId)) return "deepseek";
  if (/^(?:claude|anthropic)(?:[-_.]|$)/iu.test(modelId)) return "anthropic";
  if (/^(?:gpt|o\d)(?:[-_.]|$)/iu.test(modelId)) return "openai";
  return "deepwrite-site";
}

function inferredReasoning(modelId: string, api: ModelApi): boolean {
  return (
    api === "google-generative-ai" ||
    /(?:deepseek|reason|thinking|[-_.]r\d)(?:[-_.]|$)/iu.test(modelId)
  );
}

function resolveDefaultThinkingLevel(
  reasoning: boolean,
  options: ModelConfigInput["thinkingLevelOptions"],
  remoteDefault: RemoteModelListItem["defaultThinkingLevel"]
): ModelConfigInput["defaultThinkingLevel"] {
  if (!reasoning) return "off";
  if (
    remoteDefault &&
    remoteDefault !== "off" &&
    options.includes(remoteDefault)
  ) {
    return remoteDefault;
  }
  return options.includes("high") ? "high" : options[0]!;
}

function createDeepWriteSiteOfficialModel(
  remote: RemoteModelListItem,
  apiKey: string,
  api: ModelApi,
  baseUrl: string
): ModelConfigInput {
  const known = KNOWN_MODEL_DEFAULTS[remote.id.toLowerCase()];
  const reasoning =
    remote.reasoning ?? known?.reasoning ?? inferredReasoning(remote.id, api);
  const thinkingLevelOptions =
    remote.thinkingLevelOptions ??
    known?.thinkingLevelOptions ??
    (api === "google-generative-ai"
      ? (["low", "medium", "high"] as const)
      : (["low", "high", "max"] as const));
  return ModelConfigInputSchema.parse({
    id: configId(remote.id),
    label: `${remote.label ?? known?.label ?? remote.id}（新官方小站）`,
    provider:
      remote.provider ?? known?.provider ?? inferredProvider(remote.id, api),
    modelId: remote.id,
    requestModelId: remote.requestModelId,
    supportsDeveloperRole:
      remote.supportsDeveloperRole ??
      (api === "openai-completions" ? false : undefined),
    toolSchemaProfile: remote.toolSchemaProfile,
    api,
    baseUrl,
    reasoning,
    defaultThinkingLevel: resolveDefaultThinkingLevel(
      reasoning,
      thinkingLevelOptions,
      remote.defaultThinkingLevel
    ),
    thinkingLevelOptions,
    temperatureOptions: remote.temperatureOptions ?? [0.1, 0.7, 1],
    ...(remote.contextWindow !== undefined && remote.maxTokens !== undefined
      ? { contextWindow: remote.contextWindow, maxTokens: remote.maxTokens }
      : {}),
    ...(remote.status === undefined ? {} : { status: remote.status }),
    ...((remote.input ?? known?.input) === undefined
      ? {}
      : { input: remote.input ?? known?.input }),
    ...((remote.output ?? known?.output) === undefined
      ? {}
      : { output: remote.output ?? known?.output }),
    ...((remote.cache ?? known?.cache) === undefined
      ? {}
      : { cache: remote.cache ?? known?.cache }),
    discount: remote.discount ?? 1,
    apiKey
  });
}

export function createDeepWriteSiteOfficialModels(
  apiKey: string,
  catalog: DeepWriteSiteOfficialRemoteCatalog,
  baseUrl = DEEPWRITE_PUBLIC_DATA_API_BASE_URL
): ModelConfigInput[] {
  const googleById = new Map(
    catalog.googleModels.map((model) => [model.id, model])
  );
  const allById = new Map(catalog.models.map((model) => [model.id, model]));
  for (const model of catalog.googleModels) {
    if (!allById.has(model.id)) allById.set(model.id, model);
  }

  const openAIBaseUrl = deepWriteSiteOfficialGatewayBaseUrl(
    "openai-completions",
    baseUrl
  );
  const googleBaseUrl = deepWriteSiteOfficialGatewayBaseUrl(
    "google-generative-ai",
    baseUrl
  );
  const models = [...allById.values()].map((remote) => {
    const google = googleById.get(remote.id);
    const resolvedRemote = google ? { ...remote, ...google } : remote;
    return createDeepWriteSiteOfficialModel(
      resolvedRemote,
      apiKey,
      google ? "google-generative-ai" : "openai-completions",
      google ? googleBaseUrl : openAIBaseUrl
    );
  });
  if (models.length === 0) {
    throw new Error("新官方小站没有返回可用模型。");
  }
  return models;
}

export function saveDeepWriteSiteOfficialModelInput(
  settings: ModelSettings,
  apiKey: string,
  catalog: DeepWriteSiteOfficialRemoteCatalog,
  baseUrl = DEEPWRITE_PUBLIC_DATA_API_BASE_URL
): ModelSettingsInput {
  const previousEnabledById = new Map(
    settings.models
      .filter(isDeepWriteSiteOfficialModel)
      .map((model) => [model.id, model.enabled !== false])
  );
  const models = settings.models
    .filter((model) => !isDeepWriteSiteOfficialModel(model))
    .map(toInput);
  const siteModels = createDeepWriteSiteOfficialModels(
    apiKey,
    catalog,
    baseUrl
  ).map((model) => ({
    ...model,
    enabled: previousEnabledById.get(model.id) ?? true
  }));
  models.push(...siteModels);
  return {
    models,
    defaultModelId:
      settings.defaultModelId &&
      models.some((model) => model.id === settings.defaultModelId)
        ? settings.defaultModelId
        : siteModels[0]!.id
  };
}

export function setDeepWriteSiteOfficialModelEnabledInput(
  settings: ModelSettings,
  modelId: string,
  enabled: boolean
): ModelSettingsInput {
  if (
    !settings.models.some(
      (model) => model.id === modelId && isDeepWriteSiteOfficialModel(model)
    )
  ) {
    throw new Error("这个新官方小站模型已不在当前目录中。");
  }
  const models = settings.models.map((model) =>
    toInput(
      model.id === modelId && isDeepWriteSiteOfficialModel(model)
        ? { ...model, enabled }
        : model
    )
  );
  const selectableModels = models.filter(
    (model) => !isDeepWriteSiteOfficialModel(model) || model.enabled !== false
  );
  return {
    models,
    defaultModelId: selectableModels.some(
      (model) => model.id === settings.defaultModelId
    )
      ? settings.defaultModelId
      : (selectableModels[0]?.id ?? "")
  };
}

export function clearDeepWriteSiteOfficialModelInput(
  settings: ModelSettings
): ModelSettingsInput {
  const models = settings.models
    .filter((model) => !isDeepWriteSiteOfficialModel(model))
    .map(toInput);
  return {
    models,
    defaultModelId: models.some((model) => model.id === settings.defaultModelId)
      ? settings.defaultModelId
      : (models[0]?.id ?? "")
  };
}
