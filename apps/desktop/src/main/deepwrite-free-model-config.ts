import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ModelConfigInputSchema,
  type ModelConfigInput
} from "@deepwrite/contracts";
import {
  deepWritePublicDataHeaders,
  deepWritePublicDataUrl
} from "./deepwrite-public-data-config";
import { electronRemoteFetch } from "./electron-remote-fetch";

export const DEEPWRITE_FREE_MODEL_CONFIG_URL =
  deepWritePublicDataUrl("MODEL.json");
export const DEEPWRITE_FREE_MODEL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

const DEEPWRITE_FREE_MODEL_SOURCE = "deepwrite-free" as const;
const REMOTE_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REMOTE_CONFIG_BYTES = 1_000_000;

interface RemoteModelConfigCache {
  version: 1;
  fetchedAt: string;
  manifest: unknown;
}

export interface DeepWriteFreeModelCatalog {
  revision: string;
  enabled: boolean;
  message: string;
  manifestAvailable: boolean;
  /**
   * True only after this process has fetched and validated an enabled,
   * version-compatible manifest. Cached or disabled manifests must never be
   * used to conclude that a previously known model was removed.
   */
  canDeprecateMissingModels: boolean;
  defaultModelId: string;
  models: ModelConfigInput[];
  /**
   * Only used by the Main process to transfer freshly fetched credentials into
   * the encrypted local secret store. Never expose this catalog to Renderer.
   */
  apiKeys: Record<string, string>;
}

type RemoteConfigFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface DeepWriteFreeModelCatalogStoreOptions {
  appVersion?: string;
  fetcher?: RemoteConfigFetcher;
  now?: () => number;
  configUrl?: string;
  refreshIntervalMs?: number;
}

const EMPTY_CATALOG: DeepWriteFreeModelCatalog = {
  revision: "",
  enabled: false,
  message: "DeepWrite 免费模型配置暂时不可用，请稍后重试。",
  manifestAvailable: false,
  canDeprecateMissingModels: false,
  defaultModelId: "",
  models: [],
  apiKeys: {}
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  maximumLength: number
): string {
  const value = record[field];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximumLength
  ) {
    throw new Error(`远程免费模型配置的 ${field} 字段无效。`);
  }
  return value.trim();
}

function normalizedVersionParts(value: string): number[] {
  return value
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function versionIsOlder(current: string, minimum: string): boolean {
  const currentParts = normalizedVersionParts(current);
  const minimumParts = normalizedVersionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart !== minimumPart) {
      return currentPart < minimumPart;
    }
  }
  return false;
}

function parseRemoteModel(raw: unknown): {
  model: ModelConfigInput;
  apiKey?: string;
  sort: number;
} {
  if (!isRecord(raw)) {
    throw new Error("远程免费模型列表中存在无效项目。");
  }
  if ("clearApiKey" in raw) {
    throw new Error("远程免费模型配置不得包含 clearApiKey 字段。 ");
  }
  const { apiKey: rawApiKey, clearApiKey: _clearApiKey, ...modelInput } = raw;
  if (
    rawApiKey !== undefined &&
    (typeof rawApiKey !== "string" ||
      !rawApiKey.trim() ||
      rawApiKey.length > 16_000)
  ) {
    throw new Error("远程免费模型配置的 apiKey 字段无效。");
  }
  const parsed = ModelConfigInputSchema.safeParse({
    ...modelInput,
    managedBy: DEEPWRITE_FREE_MODEL_SOURCE
  });
  if (!parsed.success) {
    throw new Error("远程免费模型参数不符合 DeepWrite 模型格式。");
  }
  const model = parsed.data;
  if (!model.id.startsWith("deepwrite-free-")) {
    throw new Error("远程免费模型 ID 必须使用 deepwrite-free- 前缀。");
  }
  const sort =
    typeof raw.sort === "number" && Number.isFinite(raw.sort) ? raw.sort : 0;
  return {
    model: {
      ...model,
      managedBy: DEEPWRITE_FREE_MODEL_SOURCE
    },
    ...(typeof rawApiKey === "string" ? { apiKey: rawApiKey.trim() } : {}),
    sort
  };
}

export function parseDeepWriteFreeModelManifest(
  raw: unknown,
  appVersion: string
): DeepWriteFreeModelCatalog {
  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    throw new Error("远程免费模型配置版本不受支持。");
  }
  const revision = requiredString(raw, "revision", 120);
  const minimumVersion =
    typeof raw.minAppVersion === "string" ? raw.minAppVersion.trim() : "";
  const status = isRecord(raw.status) ? raw.status : {};
  const remotelyEnabled = status.enabled !== false;
  const remoteMessage =
    typeof status.message === "string" && status.message.trim()
      ? status.message.trim().slice(0, 500)
      : remotelyEnabled
        ? ""
        : "DeepWrite 免费模型当前已暂停使用。";
  const versionTooOld = Boolean(
    minimumVersion && versionIsOlder(appVersion, minimumVersion)
  );
  const enabled = remotelyEnabled && !versionTooOld;
  const message = versionTooOld
    ? `当前版本过低，请升级到 DeepWrite ${minimumVersion} 或更高版本。`
    : remoteMessage;

  if (!Array.isArray(raw.models) || raw.models.length > 50) {
    throw new Error("远程免费模型列表无效或数量超过限制。");
  }
  const parsedRemoteModels = raw.models
    .filter((model) => !isRecord(model) || model.enabled !== false)
    .map(parseRemoteModel)
    .sort((left, right) => left.sort - right.sort);
  const parsedModels = parsedRemoteModels.map(({ model }) => model);
  const uniqueIds = new Set(parsedModels.map((model) => model.id));
  if (uniqueIds.size !== parsedModels.length) {
    throw new Error("远程免费模型 ID 不能重复。");
  }
  const requestedDefaultModelId =
    typeof raw.defaultModelId === "string" ? raw.defaultModelId.trim() : "";
  const defaultModelId = uniqueIds.has(requestedDefaultModelId)
    ? requestedDefaultModelId
    : (parsedModels[0]?.id ?? "");
  return {
    revision,
    enabled,
    message,
    manifestAvailable: true,
    canDeprecateMissingModels: false,
    defaultModelId,
    models: parsedModels,
    apiKeys: enabled
      ? Object.fromEntries(
          parsedRemoteModels.flatMap(({ model, apiKey }) =>
            apiKey ? [[model.id, apiKey]] : []
          )
        )
      : {}
  };
}

/** Keep remote credentials out of the JSON cache; they belong in safeStorage. */
function withoutApiKeys(manifest: unknown): unknown {
  if (!isRecord(manifest) || !Array.isArray(manifest.models)) {
    return manifest;
  }
  return {
    ...manifest,
    models: manifest.models.map((model) => {
      if (!isRecord(model)) {
        return model;
      }
      const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
      return identity;
    })
  };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export class DeepWriteFreeModelCatalogStore {
  private readonly cachePath: string;
  private readonly appVersion: string;
  private readonly fetcher: RemoteConfigFetcher;
  private readonly now: () => number;
  private readonly configUrl: string;
  private readonly refreshIntervalMs: number;
  private readonly cacheLoad: Promise<void>;
  private catalog: DeepWriteFreeModelCatalog = structuredClone(EMPTY_CATALOG);
  private lastAttemptAt = 0;
  private refreshPromise: Promise<void> | undefined;

  constructor(
    userDataPath: string,
    options: DeepWriteFreeModelCatalogStoreOptions = {}
  ) {
    this.cachePath = join(
      userDataPath,
      "config",
      "deepwrite-free-models-cache.json"
    );
    this.appVersion = options.appVersion ?? "0.0.0";
    this.fetcher = options.fetcher ?? electronRemoteFetch;
    this.now = options.now ?? Date.now;
    this.configUrl = options.configUrl ?? DEEPWRITE_FREE_MODEL_CONFIG_URL;
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? DEEPWRITE_FREE_MODEL_REFRESH_INTERVAL_MS;
    this.cacheLoad = this.loadCache();
  }

  async initialize(): Promise<void> {
    await this.cacheLoad;
    await this.refresh(true);
  }

  async getCatalog(): Promise<DeepWriteFreeModelCatalog> {
    await this.cacheLoad;
    await this.refresh(false);
    return structuredClone(this.catalog);
  }

  async refreshCatalog(): Promise<DeepWriteFreeModelCatalog> {
    await this.cacheLoad;
    await this.refresh(true, true);
    return structuredClone(this.catalog);
  }

  private async refresh(force: boolean, reportFailure = false): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    const now = this.now();
    if (
      !force &&
      this.lastAttemptAt > 0 &&
      now - this.lastAttemptAt < this.refreshIntervalMs
    ) {
      return;
    }
    this.lastAttemptAt = now;
    const operation = this.fetchAndCache(now, reportFailure);
    this.refreshPromise = operation;
    try {
      await operation;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async fetchAndCache(
    now: number,
    reportFailure: boolean
  ): Promise<void> {
    try {
      const response = await this.fetcher(this.configUrl, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
        headers: deepWritePublicDataHeaders({ Accept: "application/json" })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_CONFIG_BYTES) {
        throw new Error("配置文件超过大小限制");
      }
      const manifest = JSON.parse(text) as unknown;
      const catalog = parseDeepWriteFreeModelManifest(
        manifest,
        this.appVersion
      );
      this.catalog = {
        ...catalog,
        canDeprecateMissingModels: catalog.enabled
      };
      const cache: RemoteModelConfigCache = {
        version: 1,
        fetchedAt: new Date(now).toISOString(),
        manifest: withoutApiKeys(manifest)
      };
      try {
        await atomicWriteJson(this.cachePath, cache);
      } catch {
        // The validated in-memory catalog remains usable if only cache persistence fails.
      }
    } catch (error: unknown) {
      if (!this.catalog.manifestAvailable) {
        this.catalog = structuredClone(EMPTY_CATALOG);
      }
      if (reportFailure) {
        const reason = error instanceof Error ? error.message : "未知错误";
        throw new Error(`刷新免费模型配置失败：${reason}`);
      }
    }
  }

  private async loadCache(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.cachePath, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !("manifest" in raw)) {
        return;
      }
      this.catalog = parseDeepWriteFreeModelManifest(
        raw.manifest,
        this.appVersion
      );
    } catch {
      this.catalog = structuredClone(EMPTY_CATALOG);
    }
  }
}
