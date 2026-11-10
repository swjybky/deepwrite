import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJevDraftModel,
  findJevProviderPreset
} from "../components/jevProviderPresets";
import type { DraftModel } from "../components/modelSettingsDraft";
import { useJevModelEditor } from "./useJevModelEditor";

function mount(model: DraftModel) {
  const scope = effectScope();
  const save = vi.fn();
  const test = vi.fn();
  const editor = scope.run(() => useJevModelEditor(model, { save, test }))!;
  return { editor, save, test, stop: () => scope.stop() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JEV model editor", () => {
  it("starts on the official host with a pinned Jev version", () => {
    const draft = createJevDraftModel("model_jev");
    expect(draft).toMatchObject({
      modelKind: "jev",
      provider: "typesafe",
      baseUrl: findJevProviderPreset("typesafe")!.baseUrl,
      modelId: "jev-1.14.0",
      reasoning: false,
      defaultThinkingLevel: "off"
    });
  });

  it("fills the endpoint and model ID when switching providers", () => {
    const { editor, stop } = mount(createJevDraftModel("model_jev"));
    editor.setProvider("aimlapi");
    expect(editor.editor.value.baseUrl).toBe(
      findJevProviderPreset("aimlapi")!.baseUrl
    );
    expect(editor.editor.value.modelId).toBe("typesafe/jev-1.14");
    expect(editor.canFetchModels.value).toBe(false);

    editor.setProvider("jev-custom");
    expect(editor.editor.value.baseUrl).toBe(
      findJevProviderPreset("aimlapi")!.baseUrl
    );
    expect(editor.showModelIdInput.value).toBe(true);
    stop();
  });

  it("configures, tests and saves OpenRouter as a Jev judgment provider", () => {
    const { editor, save, test, stop } = mount(
      createJevDraftModel("model_jev")
    );

    editor.setProvider("openrouter");

    expect(editor.providerOptions.value).toContainEqual({
      value: "openrouter",
      label: "OpenRouter"
    });
    expect(editor.editor.value).toMatchObject({
      provider: "openrouter",
      baseUrl: findJevProviderPreset("openrouter")!.baseUrl,
      modelId: "typesafe/jev-1.14"
    });
    expect(new URL(editor.editor.value.baseUrl).pathname).toBe("/api/v1");
    expect(editor.canFetchModels.value).toBe(true);
    expect(editor.showModelIdInput.value).toBe(false);
    expect(editor.modelIdOptions.value.map((option) => option.value)).toEqual([
      "typesafe/jev-1.14",
      "typesafe/jev-1.13",
      "~typesafe/jev-latest"
    ]);

    editor.editor.value.apiKey = "invalid-test-key";
    editor.setModelId("~typesafe/jev-latest");
    editor.test();
    editor.save();

    const identity = {
      provider: "openrouter",
      modelKind: "jev",
      modelId: "~typesafe/jev-latest",
      apiKey: "invalid-test-key",
      reasoning: false,
      defaultThinkingLevel: "off"
    };
    expect(test).toHaveBeenCalledWith(expect.objectContaining(identity));
    expect(save).toHaveBeenCalledWith({
      model: expect.objectContaining(identity)
    });
    stop();
  });

  it("saves only Jev fields, even for a legacy JEV config", () => {
    const legacy: DraftModel = {
      id: "model_old",
      originalId: "model_old",
      label: "Old Jev",
      provider: "deepseek",
      modelId: "jev-latest",
      modelKind: "jev",
      api: "anthropic-messages",
      baseUrl: "https://api.example.test/v1",
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["medium"],
      temperatureOptions: [0.1, 0.7, 1],
      toolSchemaProfile: "portable",
      contextWindow: 128_000,
      maxTokens: 8_000,
      hasApiKey: true
    };
    const { editor, save, test, stop } = mount(legacy);
    expect(editor.editor.value.provider).toBe("deepseek");

    editor.test();
    editor.save();

    const saved = save.mock.calls[0]![0] as {
      model: DraftModel;
      originalId?: string;
      selectedModels?: unknown;
    };
    expect(saved.originalId).toBe("model_old");
    expect(saved.selectedModels).toBeUndefined();
    expect(saved.model).toMatchObject({
      modelKind: "jev",
      api: "openai-completions",
      reasoning: false,
      defaultThinkingLevel: "off",
      hasApiKey: true
    });
    expect(saved.model).not.toHaveProperty("toolSchemaProfile");
    expect(saved.model).not.toHaveProperty("contextWindow");
    expect(saved.model).not.toHaveProperty("apiKey");
    expect(test).toHaveBeenCalledWith(
      expect.objectContaining({ modelKind: "jev", modelId: "jev-latest" })
    );
    stop();
  });

  it("lists Jev models from the API root and drops unrelated entries", async () => {
    const listRemote = vi.fn(async () => ({
      models: [{ id: "gpt-6-luna" }, { id: "jev-latest" }, { id: "jev-1.14.0" }]
    }));
    vi.stubGlobal("window", { deepwrite: { models: { listRemote } } });
    const { editor, stop } = mount({
      ...createJevDraftModel("model_jev"),
      provider: "abacus",
      baseUrl: "https://routellm.example.test/v1/systemone",
      modelId: "",
      apiKey: "sk-placeholder"
    });

    await editor.fetchModels();

    expect(listRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://routellm.example.test/v1",
        api: "openai-completions",
        apiKey: "sk-placeholder"
      })
    );
    expect(editor.modelIdOptions.value.map((option) => option.value)).toEqual([
      "jev-latest",
      "jev-preview",
      "jev-1.14.0"
    ]);
    expect(editor.editor.value.modelId).toBe("jev-latest");
    stop();
  });

  it("lists namespaced OpenRouter Jev models without including Jev Router", async () => {
    const listRemote = vi.fn(async () => ({
      models: [
        { id: "typesafe/jev-router" },
        { id: "other/jev-helper" },
        { id: "other/chat" },
        { id: "typesafe/jev-1.14" },
        { id: "typesafe/jev-1.13-20260917" },
        { id: "~typesafe/jev-latest" },
        { id: "typesafe/jev-1.14" }
      ]
    }));
    vi.stubGlobal("window", { deepwrite: { models: { listRemote } } });
    const { editor, stop } = mount({
      ...createJevDraftModel("model_jev"),
      provider: "openrouter",
      baseUrl: "https://gateway.example.test/api/v1/systemone/",
      modelId: "",
      apiKey: "invalid-test-key"
    });

    await editor.fetchModels();

    expect(listRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        baseUrl: "https://gateway.example.test/api/v1",
        api: "openai-completions",
        apiKey: "invalid-test-key"
      })
    );
    expect(editor.modelIdOptions.value.map((option) => option.value)).toEqual([
      "typesafe/jev-1.14",
      "typesafe/jev-1.13",
      "~typesafe/jev-latest",
      "typesafe/jev-1.13-20260917"
    ]);
    expect(editor.editor.value.modelId).toBe("typesafe/jev-1.14");
    stop();
  });
});
