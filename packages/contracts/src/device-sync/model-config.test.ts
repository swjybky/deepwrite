import { describe, expect, it } from "vitest";
import { checkedSyncItem } from "./validation";
import {
  SYNC_MODEL_FILE,
  SYNC_MODEL_SECRET_FILE,
  isSyncableModelId,
  parseSyncModelEntry,
  syncModelConfigItem,
  syncModelConfigSchema,
  toSyncModelConfig,
  type SyncModelConfig
} from "./model-config";

function model(overrides: Record<string, unknown> = {}): SyncModelConfig {
  return syncModelConfigSchema.parse({
    id: "model_writer-1",
    label: "写作模型",
    provider: "custom",
    modelId: "writer-v1",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    ...overrides
  });
}

describe("synced model configuration", () => {
  it("round-trips through a sync item with stable content", () => {
    const item = syncModelConfigItem(model());
    expect(item).toMatchObject({
      kind: "model-config",
      id: "model_writer-1",
      title: "写作模型"
    });
    expect(Object.keys(item.files)).toEqual([SYNC_MODEL_FILE]);
    expect(parseSyncModelEntry(checkedSyncItem(item))).toEqual({
      model: model()
    });
    expect(syncModelConfigItem(model()).files).toEqual(item.files);
  });

  it("carries an API key only as a separate secret file", () => {
    const withKey = syncModelConfigItem(model(), "sk-sync-test-only");
    expect(Object.keys(withKey.files)).toEqual([
      SYNC_MODEL_FILE,
      SYNC_MODEL_SECRET_FILE
    ]);
    expect(withKey.files[SYNC_MODEL_FILE]).toBe(
      syncModelConfigItem(model()).files[SYNC_MODEL_FILE]
    );
    expect(withKey.files[SYNC_MODEL_FILE]).not.toContain("sk-");
    expect(withKey.files[SYNC_MODEL_SECRET_FILE]).toBe(
      '{"apiKey":"sk-sync-test-only","kind":"deepwrite.model-secret","schemaVersion":1}'
    );
    expect(parseSyncModelEntry(checkedSyncItem(withKey))).toEqual({
      model: model(),
      apiKey: "sk-sync-test-only"
    });
    expect(syncModelConfigItem(model(), "").files).toEqual(
      syncModelConfigItem(model()).files
    );
  });

  it("writes the exact bytes the mobile app writes", () => {
    expect(syncModelConfigItem(model()).files[SYNC_MODEL_FILE]).toBe(
      '{"kind":"deepwrite.model-config","model":{"api":"openai-completions","baseUrl":"https://example.test/v1",' +
        '"defaultThinkingLevel":"off","id":"model_writer-1","label":"写作模型","modelId":"writer-v1","provider":"custom",' +
        '"reasoning":false,"temperatureOptions":[0.1,0.7,1],"thinkingLevelOptions":["minimal","low","medium","high","xhigh","max"]},' +
        '"schemaVersion":1}'
    );
  });

  it("accepts an unset endpoint and optional fields", () => {
    expect(model({ baseUrl: "" }).baseUrl).toBe("");
    expect(model({ contextWindow: 32_768, maxTokens: 4_096 })).toMatchObject({
      contextWindow: 32_768,
      maxTokens: 4_096
    });
    expect(model({ modelKind: "jev" }).modelKind).toBe("jev");
  });

  it("round-trips JEV model kind across devices", () => {
    const configured = model({ modelKind: "jev" });
    const item = syncModelConfigItem(configured);
    expect(parseSyncModelEntry(checkedSyncItem(item)).model).toEqual(
      configured
    );
    expect(item.files[SYNC_MODEL_FILE]).toContain('"modelKind":"jev"');
  });

  it("round-trips custom context and output limits across devices", () => {
    const configured = model({ contextWindow: 128_000, maxTokens: 8_000 });
    const item = syncModelConfigItem(configured);
    expect(parseSyncModelEntry(checkedSyncItem(item)).model).toEqual(
      configured
    );
    expect(item.files[SYNC_MODEL_FILE]).toContain('"contextWindow":128000');
    expect(item.files[SYNC_MODEL_FILE]).toContain('"maxTokens":8000');
  });

  it.each([
    ["an API key", { apiKey: "sk-invalid-placeholder" }],
    ["managed-catalog flags", { managedBy: "deepwrite-free" }],
    ["a managed model id", { id: "deepwrite-free-writing" }],
    ["an id with unsafe characters", { id: "../model" }],
    ["an over-long id", { id: "a".repeat(121) }],
    ["endpoint credentials", { baseUrl: "https://user:pass@example.test/v1" }],
    ["a non-HTTP endpoint", { baseUrl: "ftp://example.test/v1" }],
    ["a context window without max tokens", { contextWindow: 32_768 }]
  ])("rejects %s", (_name, overrides) => {
    expect(() => model(overrides)).toThrow();
  });

  it("keeps key material out of the model file even if a local model carries it", () => {
    const projected = toSyncModelConfig({
      ...model(),
      apiKey: "sk-invalid-placeholder",
      hasApiKey: true,
      inputPricePerMillion: 1
    });
    expect(Object.keys(projected)).not.toContain("apiKey");
    expect(syncModelConfigItem(projected).files[SYNC_MODEL_FILE]).not.toContain(
      "sk-"
    );
  });

  it("rejects items whose file, identity or shape do not match", () => {
    const item = syncModelConfigItem(model(), "sk-sync-test-only");
    const file = JSON.parse(item.files[SYNC_MODEL_FILE]!) as {
      model: Record<string, unknown>;
    };
    const secret = JSON.parse(item.files[SYNC_MODEL_SECRET_FILE]!) as Record<
      string,
      unknown
    >;
    const tampered = (change: (value: typeof file) => void): string => {
      const copy = structuredClone(file);
      change(copy);
      return JSON.stringify(copy);
    };
    const modelOnly = syncModelConfigItem(model());
    const bad = [
      { ...item, id: "another-id" },
      { ...item, kind: "book" },
      { ...modelOnly, files: { "other.json": item.files[SYNC_MODEL_FILE]! } },
      {
        ...modelOnly,
        files: { ...modelOnly.files, "extra.md": "# not a model" }
      },
      { ...item, files: { ...item.files, "extra.md": "# not a model" } },
      {
        ...item,
        files: { [SYNC_MODEL_SECRET_FILE]: item.files[SYNC_MODEL_SECRET_FILE]! }
      },
      {
        ...item,
        files: {
          ...item.files,
          [SYNC_MODEL_FILE]: tampered((value) => {
            value.model.apiKey = "sk-invalid-placeholder";
          })
        }
      },
      { ...item, files: { ...item.files, [SYNC_MODEL_FILE]: "not json" } },
      {
        ...item,
        files: { ...item.files, [SYNC_MODEL_SECRET_FILE]: "not json" }
      },
      ...[
        { ...secret, apiKey: "" },
        { ...secret, apiKey: "k".repeat(1_025) },
        { ...secret, extra: true },
        { ...secret, kind: "deepwrite.model-config" },
        { ...secret, schemaVersion: 2 }
      ].map((value) => ({
        ...item,
        files: {
          ...item.files,
          [SYNC_MODEL_SECRET_FILE]: JSON.stringify(value)
        }
      }))
    ];
    for (const candidate of bad)
      expect(() => checkedSyncItem(candidate)).toThrow();
  });

  it("allows the secret file for model items only", () => {
    const book = {
      kind: "book",
      id: "one",
      title: "短篇",
      files: {
        "deepwrite.json": "{}",
        [SYNC_MODEL_SECRET_FILE]: "{}"
      }
    };
    expect(() => checkedSyncItem(book)).toThrow("不受支持的文件");
    expect(() =>
      checkedSyncItem({ ...book, files: { "deepwrite.json": "{}" } })
    ).not.toThrow();
  });

  it("classifies which model ids can travel", () => {
    expect(isSyncableModelId("2f1c9e2a-7c3d-4b8e-9d55-0a1b2c3d4e5f")).toBe(
      true
    );
    expect(isSyncableModelId("model_writer-1")).toBe(true);
    expect(isSyncableModelId("deepwrite-deepseek-v4-flash")).toBe(false);
    expect(isSyncableModelId("has space")).toBe(false);
    expect(isSyncableModelId("")).toBe(false);
  });
});
