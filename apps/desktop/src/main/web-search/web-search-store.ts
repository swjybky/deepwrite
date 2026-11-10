import { withConfigurationLock } from "../configuration-lock";
import { join } from "node:path";
import {
  DEFAULT_WEB_SEARCH_STORED_SETTINGS,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_IDS,
  WebSearchProfileParamsSchema,
  WebSearchSettingsSchema,
  WebSearchStoredSettingsSchema,
  type WebSearchKeySource,
  type WebSearchProviderId,
  type WebSearchSettings,
  type WebSearchStoredProfile,
  type WebSearchStoredSettings
} from "@deepwrite/contracts";
import { SafeWebSearchError } from "./web-search-errors";
import {
  WEB_SEARCH_CONFIG_FILE,
  readWebSearchJson,
  writeWebSearchJson
} from "./web-search-json";

/** What `config/web-search.json` holds; keys stay encrypted at rest. */
export interface StoredWebSearch {
  settings: WebSearchStoredSettings;
  encryptedApiKeys: Partial<Record<WebSearchProviderId, string>>;
}

function corrupt(): SafeWebSearchError {
  return new SafeWebSearchError(
    `联网搜索配置文件（${WEB_SEARCH_CONFIG_FILE}）损坏，无法读取。`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultState(): StoredWebSearch {
  return {
    settings: structuredClone(DEFAULT_WEB_SEARCH_STORED_SETTINGS),
    encryptedApiKeys: {}
  };
}

function parseState(raw: unknown): StoredWebSearch {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.encryptedApiKeys))
    throw corrupt();
  const settings = WebSearchStoredSettingsSchema.safeParse(raw.settings);
  if (!settings.success) throw corrupt();
  const encryptedApiKeys: StoredWebSearch["encryptedApiKeys"] = {};
  // Only known provider IDs are read, so a crafted file cannot add other keys.
  for (const id of WEB_SEARCH_PROVIDER_IDS) {
    if (!Object.hasOwn(raw.encryptedApiKeys, id)) continue;
    const value = raw.encryptedApiKeys[id];
    if (typeof value !== "string" || !value) throw corrupt();
    encryptedApiKeys[id] = value;
  }
  return { settings: settings.data, encryptedApiKeys };
}

export function defaultProfileParams(providerId: WebSearchProviderId) {
  return WebSearchProfileParamsSchema.parse({
    providerId,
    maxResults: WEB_SEARCH_PROVIDERS[providerId].defaultMaxResults
  });
}

/** Stores a profile in place of the same provider's earlier one. */
export function withProfile(
  profiles: readonly WebSearchStoredProfile[],
  profile: WebSearchStoredProfile
): WebSearchStoredProfile[] {
  return [
    ...profiles.filter((entry) => entry.providerId !== profile.providerId),
    profile
  ];
}

/** Sets or clears one provider's key source, keeping its other parameters. */
export function withProfileKeySource(
  profiles: readonly WebSearchStoredProfile[],
  providerId: WebSearchProviderId,
  keySource: WebSearchKeySource | undefined
): WebSearchStoredProfile[] {
  const existing: WebSearchStoredProfile =
    profiles.find((entry) => entry.providerId === providerId) ??
    defaultProfileParams(providerId);
  const { keySource: _previous, ...params } = existing;
  return withProfile(profiles, {
    ...params,
    ...(keySource ? { keySource } : {})
  });
}

/** One profile per known provider; a key source only counts while a key exists. */
export function toPublicSettings(state: StoredWebSearch): WebSearchSettings {
  const { settings } = state;
  return WebSearchSettingsSchema.parse({
    enabled: settings.enabled,
    activeProviderId: settings.activeProviderId,
    perRunCallLimit: settings.perRunCallLimit,
    profiles: WEB_SEARCH_PROVIDER_IDS.map((providerId) => {
      const stored: WebSearchStoredProfile =
        settings.profiles.find((entry) => entry.providerId === providerId) ??
        defaultProfileParams(providerId);
      const { keySource, ...params } = stored;
      const hasApiKey = Boolean(state.encryptedApiKeys[providerId]);
      return {
        ...params,
        hasApiKey,
        ...(hasApiKey && keySource ? { keySource } : {})
      };
    })
  });
}

export class WebSearchStore {
  private readonly path: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.path = join(userDataPath, WEB_SEARCH_CONFIG_FILE);
  }

  async read(): Promise<StoredWebSearch> {
    await this.chain;
    return this.load();
  }

  /**
   * Applies one mutation to the freshly read state and commits it atomically.
   * Mutations run one after another; a failed one leaves the file untouched.
   */
  update(
    mutate: (state: StoredWebSearch) => StoredWebSearch
  ): Promise<StoredWebSearch> {
    const result = this.chain.then(() =>
      withConfigurationLock(this.path, async () => {
        const next = parseState({
          version: 1,
          ...mutate(await this.load())
        });
        await writeWebSearchJson(this.path, { version: 1, ...next });
        return next;
      })
    );
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async load(): Promise<StoredWebSearch> {
    const raw = await readWebSearchJson(this.path);
    return raw === undefined ? defaultState() : parseState(raw);
  }
}
