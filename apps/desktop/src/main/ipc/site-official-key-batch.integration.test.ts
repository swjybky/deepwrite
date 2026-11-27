import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  ModelSettingsSchema,
  type ModelSettings,
  type ModelSettingsInput,
  type CommandResult
} from "@deepwrite/contracts";
import {
  mergeSiteOfficialQuota,
  querySiteOfficialQuota,
  saveSiteOfficialModelToken
} from "../../preload/site-official-models-api";
import {
  mergeSiteOfficialKeyBatch,
  parseSiteOfficialKeyLines
} from "../../renderer/src/composables/siteOfficialKeyBatch";
import { createModelApiTestFixture } from "../../renderer/src/composables/modelApi.test-support";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: { invoke } }));
vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test"
}));

const target = "target_test_only_invalid";
const source = "source_test_only_invalid";
const failed = "failed_test_only_invalid";
const last = "last_test_only_invalid";

function setup() {
  let settings: ModelSettings = { defaultModelId: "", models: [] };
  let savedKey = "";
  let transferred = 0;
  const responses: CommandResult[] = [];
  const store = {
    list: vi.fn(async () => settings),
    save: vi.fn(async (input: ModelSettingsInput) => {
      savedKey = input.models[0]!.apiKey!;
      settings = ModelSettingsSchema.parse({
        ...input,
        models: input.models.map(({ apiKey, ...model }) => ({
          ...model,
          hasApiKey: Boolean(apiKey)
        }))
      });
      return settings;
    }),
    resolveDraftApiKey: vi.fn(async () => savedKey)
  };
  function quota() {
    return {
      object: "api_key_quota",
      currency: "CNY",
      queried_at: "2026-09-09T00:00:00Z",
      status: "active",
      unlimited: false,
      total: String(10 + transferred),
      used: "0",
      remaining: String(10 + transferred)
    };
  }
  const remoteFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${target}`
    );
    if (init?.method !== "POST") return Response.json(quota());
    const body = JSON.parse(init.body as string) as { source_key: string };
    if (body.source_key === failed) {
      return Response.json(
        { error: { code: "invalid_source_key", message: failed } },
        { status: 400 }
      );
    }
    transferred += 3;
    return Response.json({
      object: "api_key_quota_merge",
      currency: "CNY",
      transferred: "3",
      source_revoked: true,
      quota: quota()
    });
  });
  const ctx = {
    requireModelConfigStore: () => store,
    requireModelUsageStore: () => ({
      syncConfiguredModels: async () => undefined
    }),
    listRemoteModels: vi.fn(async (input: { api: string; apiKey: string }) => {
      expect(input.apiKey).toBe("");
      return input.api === "openai-completions" ? [{ id: "writer-test" }] : [];
    }),
    remoteFetch
  } as unknown as ModelCommandContext;
  invoke.mockImplementation(async (_channel, raw) => {
    const result = await handleModelCommands(
      ctx,
      CommandEnvelopeSchema.parse(raw)
    );
    responses.push(result!);
    return result;
  });
  const models = {
    ...createModelApiTestFixture(),
    mergeSiteOfficialQuota,
    querySiteOfficialQuota
  };
  return { store, remoteFetch, responses, models };
}

describe("multiline site keys through preload and Main", () => {
  it("saves the target only, calls each source separately, and keeps going after a sanitized rejection", async () => {
    const { store, remoteFetch, responses, models } = setup();
    const keys = parseSiteOfficialKeyLines(
      `${target}\n${source}\n${failed}\n${last}`
    );
    const saved = await saveSiteOfficialModelToken(keys[0]!.key);
    expect(saved.models).toHaveLength(1);
    const quota = await querySiteOfficialQuota();
    let latestQuota = quota;
    const result = await mergeSiteOfficialKeyBatch({
      models,
      sources: keys.slice(1),
      target: keys[0]!,
      quota,
      current: () => true,
      applyQuota: (value) => {
        latestQuota = value;
      }
    });
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save.mock.calls[0]![0].models[0]!.apiKey).toBe(target);
    const posts = remoteFetch.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    );
    expect(posts.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      { source_key: source },
      { source_key: failed },
      { source_key: last }
    ]);
    expect(result.succeeded.map(({ line }) => line)).toEqual([2, 4]);
    expect(result.failed).toEqual([
      { line: 3, message: "来源 Key 无效、已注销或已过期，请检查后重试。" }
    ]);
    expect(latestQuota.remaining).toBe(16);
    for (const key of [target, source, failed, last]) {
      expect(JSON.stringify(responses)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain(key);
    }
  });
});
