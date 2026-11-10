import {
  WEB_SEARCH_PROVIDERS,
  webSearchProvider,
  WebSearchRuntimeConfigSchema,
  WebSearchSettingsInputSchema,
  WebSearchTestInputSchema,
  WebSearchTestResultSchema,
  type WebSearchImportKeyInput,
  type WebSearchKeyImportCandidates,
  type WebSearchProviderId,
  type WebSearchRuntimeConfig,
  type WebSearchSettings,
  type WebSearchSettingsInput,
  type WebSearchTestInput,
  type WebSearchTestResult
} from "@deepwrite/contracts";
import type { VoiceSecureStorage } from "../voice/voice-persistence";
import { SafeWebSearchError, safeWebSearchError } from "./web-search-errors";
import {
  importKey,
  listKeyImportCandidates,
  type WebSearchKeyImportDependencies,
  type WebSearchKeySourceReader
} from "./web-search-key-import";
import { WebSearchSecrets } from "./web-search-secrets";
import {
  WebSearchStore,
  toPublicSettings,
  withProfile
} from "./web-search-store";

const DEFAULT_TEST_QUERY = "DeepWrite";
const TEST_TIMEOUT_MS = 30_000;

export interface WebSearchTestRequest {
  providerId: WebSearchProviderId;
  baseUrl: string;
  apiKey: string;
  query: string;
  signal: AbortSignal;
}

/**
 * Runs one search against the provider. Implementations throw
 * `SafeWebSearchError` for failures worth telling the user about.
 */
export type WebSearchTester = (
  request: WebSearchTestRequest
) => Promise<Pick<WebSearchTestResult, "resultCount" | "samples">>;

export interface WebSearchServiceOptions {
  secureStorage: VoiceSecureStorage;
  keySources: WebSearchKeySourceReader;
  tester?: WebSearchTester;
  now?: () => number;
  warn?: (message: string) => void;
}

export class WebSearchService {
  private readonly store: WebSearchStore;
  private readonly secrets: WebSearchSecrets;
  private readonly importDependencies: WebSearchKeyImportDependencies;
  private readonly now: () => number;

  constructor(
    userDataPath: string,
    private readonly options: WebSearchServiceOptions
  ) {
    this.store = new WebSearchStore(userDataPath);
    this.secrets = new WebSearchSecrets(options.secureStorage);
    this.now = options.now ?? Date.now;
    this.importDependencies = {
      store: this.store,
      secrets: this.secrets,
      keySources: options.keySources,
      now: this.now
    };
  }

  async getSettings(): Promise<WebSearchSettings> {
    return toPublicSettings(await this.store.read());
  }

  async saveSettings(
    rawInput: WebSearchSettingsInput
  ): Promise<WebSearchSettings> {
    const parsed = WebSearchSettingsInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw new SafeWebSearchError("联网搜索配置无效，请检查填写内容。");
    const input = parsed.data;
    const state = await this.store.update((current) => {
      const encryptedApiKeys = { ...current.encryptedApiKeys };
      let profiles = current.settings.profiles;
      for (const { apiKey, clearApiKey, ...params } of input.profiles) {
        const id = params.providerId;
        const existing = profiles.find((entry) => entry.providerId === id);
        let keySource = existing?.keySource;
        if (clearApiKey) {
          delete encryptedApiKeys[id];
          keySource = undefined;
        } else if (apiKey) {
          encryptedApiKeys[id] = this.secrets.encrypt(apiKey);
          keySource = { kind: "manual" };
        }
        profiles = withProfile(profiles, {
          ...params,
          ...(keySource ? { keySource } : {})
        });
      }
      return {
        settings: {
          enabled: input.enabled,
          activeProviderId: input.activeProviderId,
          perRunCallLimit: input.perRunCallLimit,
          profiles
        },
        encryptedApiKeys
      };
    });
    return toPublicSettings(state);
  }

  async setEnabled(enabled: boolean): Promise<WebSearchSettings> {
    const state = await this.store.update((current) => ({
      ...current,
      settings: { ...current.settings, enabled }
    }));
    return toPublicSettings(state);
  }

  /**
   * Search configuration for one run, or undefined when the tool must not be
   * mounted: switched off, missing configuration, or an unreadable file or key. A
   * broken configuration never stops a conversation.
   */
  async resolveRuntime(): Promise<WebSearchRuntimeConfig | undefined> {
    try {
      const { settings, encryptedApiKeys } = await this.store.read();
      if (!settings.enabled) return undefined;
      const providerId = settings.activeProviderId;
      const encrypted = encryptedApiKeys[providerId];
      const descriptor = webSearchProvider(providerId);
      if (!encrypted && descriptor.requiresApiKey !== false) return undefined;
      const profile = settings.profiles.find(
        (entry) => entry.providerId === providerId
      );
      if (!(profile?.baseUrl ?? descriptor.defaultBaseUrl)) return undefined;
      return WebSearchRuntimeConfigSchema.parse({
        providerId,
        baseUrl: profile?.baseUrl ?? descriptor.defaultBaseUrl,
        apiKey: encrypted ? this.secrets.decrypt(encrypted) : "",
        maxResults: profile?.maxResults ?? descriptor.defaultMaxResults,
        perRunCallLimit: settings.perRunCallLimit
      });
    } catch (error) {
      (this.options.warn ?? console.warn)(
        `联网搜索配置不可用，本次运行不挂载联网搜索：${safeWebSearchError(error)}`
      );
      return undefined;
    }
  }

  async test(rawInput: WebSearchTestInput): Promise<WebSearchTestResult> {
    const input = WebSearchTestInputSchema.parse(rawInput);
    if (!this.options.tester)
      throw new SafeWebSearchError("联网搜索测试暂不可用。");
    const apiKey =
      input.apiKey?.trim() || (await this.savedKey(input.providerId));
    if (!apiKey && webSearchProvider(input.providerId).requiresApiKey !== false)
      throw new SafeWebSearchError("请先填写联网搜索 API Key。");
    const baseUrl =
      input.baseUrl ??
      (await this.store.read()).settings.profiles.find(
        (profile) => profile.providerId === input.providerId
      )?.baseUrl ??
      WEB_SEARCH_PROVIDERS[input.providerId].defaultBaseUrl;
    if (!baseUrl) throw new SafeWebSearchError("请先填写搜索服务接口地址。");
    const started = this.now();
    const result = await this.options.tester({
      providerId: input.providerId,
      baseUrl,
      apiKey,
      query: input.query ?? DEFAULT_TEST_QUERY,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
    });
    return WebSearchTestResultSchema.parse({
      resultCount: result.resultCount,
      elapsedMs: Math.max(0, Math.round(this.now() - started)),
      samples: result.samples.slice(0, 3)
    });
  }

  listKeyImportCandidates(
    providerId: WebSearchProviderId
  ): Promise<WebSearchKeyImportCandidates> {
    return listKeyImportCandidates(this.importDependencies, providerId);
  }

  importKey(input: WebSearchImportKeyInput): Promise<WebSearchSettings> {
    return importKey(this.importDependencies, input);
  }

  private async savedKey(providerId: WebSearchProviderId): Promise<string> {
    const encrypted = (await this.store.read()).encryptedApiKeys[providerId];
    return encrypted ? this.secrets.decrypt(encrypted) : "";
  }
}
