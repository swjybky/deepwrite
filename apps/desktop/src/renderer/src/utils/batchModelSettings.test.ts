import { describe, expect, it } from "vitest";
import type { DraftModel } from "../components/modelSettingsDraft";
import { applyBatchModelSettings } from "./batchModelSettings";
import { resolveSavedModelLabel } from "./customModelLabel";

const source: DraftModel = {
  id: "saved",
  label: "我的写作模型",
  provider: "custom",
  modelId: "writer",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["medium", "high"],
  temperatureOptions: [0.1, 0.7, 1],
  hasApiKey: true,
  requestModelId: "writer-route",
  contextWindow: 32000,
  maxTokens: 4000
};

describe("batch model configuration", () => {
  it("updates selected existing models and adds each new model once with shared settings", () => {
    const models = applyBatchModelSettings([source], {
      model: source,
      originalId: source.id,
      selectedModels: [
        { id: "writer" },
        { id: "reader", label: "阅读模型" },
        { id: "reader" }
      ]
    });
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: source.id,
      label: "我的写作模型（writer）",
      contextWindow: 32000
    });
    expect(models[1]).toMatchObject({
      modelId: "reader",
      label: "我的写作模型（reader）",
      provider: source.provider,
      baseUrl: source.baseUrl,
      defaultThinkingLevel: "high",
      sourceApiKeyId: source.id
    });
    expect(models[1]).not.toHaveProperty("requestModelId");
    expect(models[1]).not.toHaveProperty("contextWindow");
    expect(models[1]).not.toHaveProperty("apiKey");
    expect(models[1]?.id).not.toBe(source.id);
  });
  it("preserves an unselected original and models on other endpoints", () => {
    const another = {
      ...source,
      id: "other",
      baseUrl: "https://other.example.test/v1"
    };
    const models = applyBatchModelSettings([source, another], {
      model: source,
      originalId: source.id,
      selectedModels: [{ id: "reader", label: "Reader" }]
    });
    expect(models.slice(0, 2)).toEqual([source, another]);
    expect(models[2]?.label).toBe("我的写作模型");
  });
  it("reuses existing ids on retry and preserves their individual capacities", () => {
    const reader = {
      ...source,
      id: "reader-config",
      modelId: "reader",
      contextWindow: 64000,
      supportsDeveloperRole: false
    };
    const payload = {
      model: source,
      originalId: source.id,
      selectedModels: [{ id: "reader" }]
    };
    const models = applyBatchModelSettings([source, reader], payload);
    expect(applyBatchModelSettings(models, payload)).toEqual(models);
    expect(models[1]).toMatchObject({
      id: "reader-config",
      contextWindow: 64000,
      supportsDeveloperRole: false
    });
  });
  it("applies explicit credentials or clearing without referencing a saved key", () => {
    for (const changes of [
      { apiKey: "invalid-test-key" },
      { clearApiKey: true }
    ]) {
      const models = applyBatchModelSettings([], {
        model: { ...source, ...changes },
        originalId: source.id,
        selectedModels: [{ id: "reader" }]
      });
      expect(models[0]).toMatchObject(changes);
      expect(models[0]).not.toHaveProperty("sourceApiKeyId");
    }
  });
  it("rejects an empty batch", () => {
    expect(() =>
      applyBatchModelSettings([source], { model: source, selectedModels: [] })
    ).toThrow("至少选择");
  });
  it("appends model ids only when saving more than one model with a shared name", () => {
    const batch = applyBatchModelSettings([], {
      model: { ...source, label: "写作" },
      selectedModels: [{ id: "chat" }, { id: "reasoner" }]
    });
    expect(batch.map((model) => model.label)).toEqual([
      "写作（chat）",
      "写作（reasoner）"
    ]);
    const single = applyBatchModelSettings([], {
      model: { ...source, label: "写作", modelId: "chat" }
    });
    expect(single[0]?.label).toBe("写作");
  });
  it("defaults an empty name to the model id", () => {
    const batch = applyBatchModelSettings([], {
      model: { ...source, label: "  " },
      selectedModels: [{ id: "chat" }, { id: "reasoner" }]
    });
    expect(batch.map((model) => model.label)).toEqual(["chat", "reasoner"]);
    const single = applyBatchModelSettings([], {
      model: { ...source, label: "", modelId: "solo-id" }
    });
    expect(single[0]?.label).toBe("solo-id");
  });
});

describe("custom model labels", () => {
  it("keeps a filled single name, suffixes batches, and falls back to the model id", () => {
    expect(resolveSavedModelLabel("写作", "chat")).toBe("写作");
    expect(resolveSavedModelLabel("写作", "chat", 2)).toBe("写作（chat）");
    expect(resolveSavedModelLabel("  ", "chat", 2)).toBe("chat");
    expect(resolveSavedModelLabel("", "solo-id")).toBe("solo-id");
  });
});
