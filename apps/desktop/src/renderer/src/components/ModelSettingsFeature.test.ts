import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import featureSource from "./ModelSettingsFeature.vue?raw";
import editorSource from "./ModelEditorPanel.vue?raw";
import advancedConfigSource from "./ModelAdvancedConfigDialog.vue?raw";
import draftSource from "../composables/useModelSettingsDraft.ts?raw";
import editorLogicSource from "../composables/useModelEditor.ts?raw";
import remoteListingSource from "../composables/useRemoteModelListing.ts?raw";
import modelDraftSource from "./modelSettingsDraft.ts?raw";
import {
  applyProviderPresetDefaults,
  MODEL_PROVIDER_OPTIONS
} from "./modelProviderPresets";

const source = [
  featureSource,
  editorSource,
  advancedConfigSource,
  draftSource,
  editorLogicSource,
  remoteListingSource,
  modelDraftSource
].join("\n");

function providerPresetTarget(): Parameters<
  typeof applyProviderPresetDefaults
>[0] {
  return {
    provider: "custom",
    api: "openai-completions",
    baseUrl: "https://example.test/v1"
  };
}

function providerLabel(provider: string): string | undefined {
  return MODEL_PROVIDER_OPTIONS.find((option) => option.value === provider)
    ?.label;
}

describe("ModelSettingsFeature DeepWrite free models", () => {
  it("does not expose the managed free provider through the add-model editor", () => {
    expect(providerLabel("deepwrite-free")).toBeUndefined();
    expect(source).not.toContain('accessible-label="选择 DeepWrite 免费模型"');
    expect(source).not.toContain("applyDeepWriteFreeModel");
    expect(source).not.toContain('emit("refreshFreeModels")');
  });

  it("renders managed free models as read-only cards with default and test actions", () => {
    expect(featureSource).toContain("DeepWrite 免费模型");
    expect(featureSource).toContain('v-if="!row.model.managedBy"');
    expect(featureSource).toContain("setDefaultModel(row.model.id)");
    expect(featureSource).toContain("testDraftModel(row.model)");
  });

  it("delegates model result feedback to the shared coordinator", () => {
    expect(draftSource).not.toContain("props.modelTestMessage");
    expect(draftSource).not.toContain("props.modelError");
  });

  it("renders the editor immediately after the model being edited", () => {
    expect(source).toContain(
      'rows.push({ key: `model:${model.id}`, type: "model", model })'
    );
    expect(source).toContain(
      'rows.push({ key: `editor:${model.id}`, type: "editor" })'
    );
    expect(source).toContain(
      '<template v-for="row in modelConfigRows" :key="row.key">'
    );
  });

  it("scrolls the model editor into view after opening it", () => {
    expect(source).toContain('ref="modelConfigScrollArea"');
    expect(source).toContain(
      '?.scrollIntoView({ block: "nearest", behavior: "auto" })'
    );
    expect(draftSource.match(/actions\.editorOpened\(\);/g)).toHaveLength(2);
  });
});

describe("ModelSettingsFeature provider presets", () => {
  it("offers an explicit PI-native or portable tool schema override", () => {
    expect(source).toContain('label: "自动（推荐）"');
    expect(source).toContain('value: "native"');
    expect(source).toContain('value: "portable"');
    expect(source).toContain('accessible-label="选择工具结构兼容模式"');
    expect(source).toContain("toolSchemaProfile: model.toolSchemaProfile");
  });

  it("places the tool schema beside and after the API address", () => {
    const apiUrlIndex = editorSource.indexOf("<span>API 地址</span>");
    const toolSchemaIndex = editorSource.indexOf("<span>工具结构</span>");
    expect(apiUrlIndex).toBeGreaterThan(-1);
    expect(toolSchemaIndex).toBeGreaterThan(apiUrlIndex);
  });

  it("offers Kimi Coding with its Anthropic-compatible API endpoint", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "kimi-coding");

    expect(providerLabel("kimi-coding")).toBe("Kimi Coding");
    expect(target.api).toBe("anthropic-messages");
    expect(new URL(target.baseUrl).protocol).toBe("https:");
  });

  it("offers Ollama with its local OpenAI-compatible endpoint", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "ollama");

    expect(providerLabel("ollama")).toBe("Ollama");
    expect(target.api).toBe("openai-completions");
    expect(new URL(target.baseUrl).hostname).toBe("127.0.0.1");
  });

  it("defaults Xiaomi MiMo TokenPlan CN to the Responses API", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "xiaomi-token-plan-cn");

    expect(providerLabel("xiaomi-token-plan-cn")).toBe(
      "小米 MiMo TokenPlan（国内）"
    );
    expect(target.provider).toBe("xiaomi-token-plan-cn");
    expect(target.api).toBe("openai-responses");
    const presetUrl = new URL(target.baseUrl);
    expect(presetUrl.protocol).toBe("https:");
    expect(presetUrl.pathname).toBe("/v1");
  });

  it.each([
    ["minimax-codeplan", "MiniMax Plan"],
    ["dashscope", "阿里云百炼"],
    ["zai-coding-cn", "智谱 Z.AI Coding Plan"],
    ["zhipu", "智谱 GLM 开放平台"],
    ["moonshot", "Kimi 开放平台"]
  ])("offers the %s OpenAI-compatible provider preset", (provider, label) => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, provider);

    expect(providerLabel(provider)).toBe(label);
    expect(target.provider).toBe(provider);
    expect(target.api).toBe("openai-completions");
    expect(new URL(target.baseUrl).protocol).toBe("https:");
  });

  it("keeps the Z.AI Coding Plan route separate from metered GLM", () => {
    const codingPlan = providerPresetTarget();
    const metered = providerPresetTarget();
    applyProviderPresetDefaults(codingPlan, "zai-coding-cn");
    applyProviderPresetDefaults(metered, "zhipu");

    expect(new URL(codingPlan.baseUrl).pathname).toBe("/api/coding/paas/v4");
    expect(new URL(metered.baseUrl).pathname).toBe("/api/paas/v4");
  });
});

describe("ModelSettingsFeature official models", () => {
  it("keeps official models selectable but hides edit and delete actions", () => {
    expect(source).toContain("旧官方小站模型");
    expect(source).toContain("新官方小站模型");
    expect(source).toContain('v-if="!row.model.managedBy"');
    expect(source).toContain("requestModelId: model.requestModelId");
    expect(source).toContain(
      "supportsDeveloperRole: model.supportsDeveloperRole"
    );
  });

  it("shows the official model price notice in place of the configuration note", () => {
    expect(source).toContain('class="dialog-description model-price-notice"');
    expect(source).toContain('v-for="(message, index) in modelAlertMessages"');
    expect(source).toContain("{{ message }}");
    expect(source).toContain("@click=\"emit('openOfficialModels')\"");
    expect(source).toContain('title="前往设置官方模型"');
    expect(source).not.toContain("官方模型已经上线！直连厂商！");
    expect(source).not.toContain("配置会同时用于连接测试与实际对话");
  });
});

describe("ModelSettingsFeature remote model ids", () => {
  it("offers a fetch button beside the model id field and turns it into a selector", () => {
    expect(source).toContain('class="model-id-field"');
    expectSourceToContain(
      source,
      ":aria-label=\"listingRemoteModels ? '拉取中' : '拉取可用模型'\""
    );
    expect(source).toContain('{{ listingRemoteModels ? "拉取中" : "拉取" }}');
    expect(source).toContain('@click="fetchRemoteModels"');
    expect(source).toContain("window.deepwrite.models.listRemote({");
    expect(source).toContain('accessible-label="选择模型 ID"');
    expect(source).toContain('label: "手动输入其他模型 ID"');
    expect(source).toContain("canSelectRemoteModel");
  });

  it("shows a dialog when the api url or key is missing", () => {
    expect(source).toContain("function missingCredentials");
    expect(source).toContain("请先填写 API 地址和 API Key，再拉取可用模型。");
    expect(source).toContain("请先填写 API 地址，再拉取可用模型。");
    expect(source).toContain("请先填写 API Key，再拉取可用模型。");
    expect(source).toContain(
      'class="dialog-backdrop model-fetch-hint-overlay"'
    );
    expect(source).toContain('id="model-fetch-hint-title"');
    expect(source).toContain("无法拉取模型");
    expect(source).toContain("fetchHintDialog.value = missing");
    expect(source).not.toContain("uiMessage.warning(missing)");
  });

  it("reuses a saved key and allows ollama without a key", () => {
    const start = source.indexOf("function missingCredentials");
    const end = source.indexOf("function commandErrorMessage", start);
    const body = source.slice(start, end);
    expect(body).toContain("!editor.hasApiKey");
    expect(body).toContain('editor.provider !== "ollama"');
  });
});

describe("ModelSettingsFeature model draft lifecycle", () => {
  it("persists a newly selected default model immediately", () => {
    const start = source.indexOf("function setDefaultModel(");
    const end = source.indexOf("function submitModelSettings(", start);
    const body = source.slice(start, end);
    expect(body).toContain("draftDefaultModelId.value = modelId;");
    expect(body).toContain("submitModelSettings();");
    expect(source).toContain(':disabled="modelSaving || Boolean(modelEditor)"');
  });

  it("hydrates saved models when the dialog mounts already active", () => {
    expect(source).toMatch(
      /watch\(\s*\(\) => props\.active,[\s\S]*?\{ immediate: true \}\s*\);/
    );
  });

  it("filters managed models and free-provider options in custom scope", () => {
    expect(source).toContain('props.modelScope === "all" || !model.managedBy');
    expect(providerLabel("deepwrite-free")).toBeUndefined();
    expectSourceToContain(
      source,
      'modelScope === "custom" ? "尚未配置自定义模型"'
    );
  });

  it("merges custom drafts with hidden managed models before saving", () => {
    expect(source).toContain("mergeCustomModelSettings(");
    expect(source).toContain("(props.modelSettings?.models ?? []).map((model)");
    expect(source).toContain("toModelInput(cloneDraftModel(model))");
  });
});

describe("ModelSettingsFeature advanced capacity", () => {
  it("places advanced configuration before delete on custom models only", () => {
    const advancedIndex = featureSource.indexOf("高级配置");
    const deleteIndex = featureSource.indexOf("removeModel(row.model.id)");
    expect(advancedIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(advancedIndex);
    expect(featureSource).toContain('@click="openAdvancedConfig(row.model)"');
    expect(featureSource).toContain("<ModelAdvancedConfigDialog");
    expect(source).toContain('v-if="!row.model.managedBy"');
  });

  it("opens a dialog for context window and max output tokens", () => {
    expect(advancedConfigSource).toContain("上下文长度");
    expect(advancedConfigSource).toContain("最高输出长度");
    expect(advancedConfigSource).toContain(
      "window.deepwrite.models.resolveCapacity"
    );
    expect(advancedConfigSource).toContain("hasCustomCapacity(model)");
    expect(advancedConfigSource).toContain("contextWindow: undefined");
    expect(advancedConfigSource).toContain("maxTokens: undefined");
    expect(advancedConfigSource).toContain("最高输出长度不能超过上下文长度。");
  });

  it("applies successful test defaults then persists edited capacity immediately", () => {
    expect(draftSource).toContain("settingsStore.lastModelTestCapacity");
    expect(draftSource).toContain("tested.modelId === cloned.id");
    expect(draftSource).toContain("applyCapacityDefaults(capacity)");
    expect(draftSource).toContain(
      "model.managedBy || model.id !== capacity.modelId"
    );
    expect(draftSource).toContain("contextWindow: capacity.contextWindow");
    expect(draftSource).toContain("maxTokens: capacity.maxTokens");
    expect(draftSource).toContain("submitModelSettings();");
    expect(modelDraftSource).toContain("contextWindow: model.contextWindow");
    expect(modelDraftSource).toContain("maxTokens: model.maxTokens");
  });
});
