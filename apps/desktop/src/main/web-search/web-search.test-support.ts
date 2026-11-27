import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  WEB_SEARCH_PROVIDERS,
  type WebSearchKeyImportModel,
  type WebSearchSettingsInput
} from "@deepwrite/contracts";
import { testSecureStorage } from "../voice/voice-test-support";
import type { WebSearchModelKeySource } from "./web-search-key-import";
import {
  WebSearchService,
  type WebSearchServiceOptions
} from "./web-search-service";

export { testSecureStorage };
export const SEARCH_KEY = "invalid-test-search-key";
export const OTHER_SEARCH_KEY = "invalid-test-other-search-key";
/** The product rule names the host, so tests never spell a real service address. */
export const DEEPSEEK_HOST =
  WEB_SEARCH_PROVIDERS.deepseek.keyImport.baseUrlHosts[0];
export const FIXED_NOW = Date.UTC(2026, 9, 17, 8, 0, 0);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

export interface FakeModel extends WebSearchKeyImportModel {
  label: string;
  apiKey: string;
}

/** Applies the real match predicate to in-memory models, like the real store. */
export function fakeKeySources(models: FakeModel[] = []) {
  const state = { models };
  return {
    state,
    listKeySources: async (
      match: (model: WebSearchKeyImportModel) => boolean
    ): Promise<WebSearchModelKeySource[]> =>
      state.models
        .filter(({ label: _label, apiKey: _apiKey, ...model }) => match(model))
        .map(({ id, label, apiKey }) => ({ id, label, apiKey }))
  };
}

export function deepSeekModel(
  id: string,
  apiKey: string,
  overrides: Partial<FakeModel> = {}
): FakeModel {
  return {
    id,
    label: `模型 ${id}`,
    provider: "deepseek",
    baseUrl: `https://${DEEPSEEK_HOST}/v1`,
    hasApiKey: true,
    apiKey,
    ...overrides
  };
}

export async function setup(
  options: Partial<WebSearchServiceOptions> & { models?: FakeModel[] } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-web-search-"));
  roots.push(root);
  const keySources = fakeKeySources(options.models);
  const warnings: string[] = [];
  const create = () =>
    new WebSearchService(root, {
      secureStorage: testSecureStorage,
      keySources,
      now: () => FIXED_NOW,
      warn: (message) => warnings.push(message),
      ...options
    });
  return { root, keySources, warnings, service: create(), create };
}

export function settingsInput(
  overrides: Partial<WebSearchSettingsInput> = {}
): WebSearchSettingsInput {
  return {
    enabled: true,
    activeProviderId: "deepseek",
    perRunCallLimit: 20,
    profiles: [{ providerId: "deepseek", maxResults: 8, apiKey: SEARCH_KEY }],
    ...overrides
  };
}
