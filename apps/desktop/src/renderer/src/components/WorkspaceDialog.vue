<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelApi,
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type ReasoningLevel,
  type TemperatureOptions,
  type ThinkingLevelOptions,
  type ThinkingLevel
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

interface DraftModel extends ModelConfig {
  apiKey?: string;
  clearApiKey?: boolean;
  customThinkingLevel?: string;
  originalId?: string;
}

const props = defineProps<{
  mode: "directory" | "models";
  active?: boolean;
  modelSettings: ModelSettings | null;
  modelLoading: boolean;
  modelSaving: boolean;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
  workspaceDirectoryPath: string | null;
  workspaceDirectoryLoading: boolean;
}>();
const emit = defineEmits<{
  saveModels: [settings: ModelSettingsInput];
  testModel: [model: ModelConfigInput];
  chooseWorkspaceDirectory: [];
}>();

const draftModels = ref<DraftModel[]>([]);
const draftDefaultModelId = ref("");
const modelEditor = ref<DraftModel | null>(null);

const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const reasoningOptions = BUILT_IN_REASONING_LEVELS.map((value) => ({
  value,
  label: builtInThinkingLabels[value]
}));
const providerOptions = [
  { value: "deepwrite-free", label: "DeepWrite 免费模型" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "custom", label: "其他兼容服务" }
] as const;
const deepwriteFreeModels = computed(() => props.modelSettings?.deepwriteFreeModels ?? []);
const deepwriteFreeModelOptions = computed(() =>
  deepwriteFreeModels.value.map((model) => ({
    value: model.id,
    label: model.label,
    description: model.modelId,
    title: model.modelId
  }))
);
const isDeepWriteFreeEditor = computed(
  () => modelEditor.value?.managedBy === "deepwrite-free"
);
const apiOptions: ReadonlyArray<{ value: ModelApi; label: string }> = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" }
];
const modelModeOptions = [
  { value: "reasoning", label: "思考模式" },
  { value: "temperature", label: "不思考模式" }
] as const;
const defaultThinkingOptions = computed(() =>
  (modelEditor.value?.thinkingLevelOptions ?? []).map((level) => ({
    value: level,
    label: thinkingLabel(level),
    title: level
  }))
);
const customThinkingLevelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isBuiltInThinkingLevel(level: string): level is BuiltInReasoningLevel {
  return BUILT_IN_REASONING_LEVELS.some((candidate) => candidate === level);
}

function findCustomThinkingLevel(options: ThinkingLevelOptions): string {
  return options.find((level) => !isBuiltInThinkingLevel(level)) ?? "";
}

function isValidCustomThinkingLevel(level: string): boolean {
  return (
    level.length <= 64 &&
    level !== "off" &&
    !isBuiltInThinkingLevel(level) &&
    customThinkingLevelPattern.test(level)
  );
}

function cloneTemperatureOptions(options: TemperatureOptions): TemperatureOptions {
  return [options[0], options[1], options[2]];
}

function cloneThinkingLevelOptions(options: ThinkingLevelOptions): ThinkingLevelOptions {
  return [...options];
}

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") {
    return "关闭";
  }
  return isBuiltInThinkingLevel(level)
    ? builtInThinkingLabels[level]
    : `自定义（${level}）`;
}

function resetModelDraft(settings: ModelSettings | null): void {
  draftModels.value = (settings?.models ?? []).map((model) => ({
    ...model,
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    customThinkingLevel: findCustomThinkingLevel(model.thinkingLevelOptions)
  }));
  draftDefaultModelId.value = settings?.defaultModelId ?? "";
  modelEditor.value = null;
}

watch(
  () => [props.mode, props.active] as const,
  ([mode, active]) => {
    if (active && mode === "models") {
      resetModelDraft(props.modelSettings);
    }
  }
);

watch(
  () => [props.modelSettings, props.modelSaving] as const,
  ([settings, saving]) => {
    if (props.active && props.mode === "models" && !saving) {
      resetModelDraft(settings);
    }
  }
);

watch(
  () => props.modelError,
  (error) => {
    if (error) {
      uiMessage.error(error);
    }
  }
);

watch(
  () => props.modelTestMessage,
  (successMessage) => {
    if (successMessage) {
      uiMessage.success(successMessage);
    }
  }
);

function createModel(): void {
  modelEditor.value = {
    id: createId("model"),
    label: "",
    provider: "deepseek",
    modelId: "",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: [...BUILT_IN_REASONING_LEVELS],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: false,
    apiKey: "",
    customThinkingLevel: ""
  };
}

function editModel(model: DraftModel): void {
  modelEditor.value = {
    ...model,
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    apiKey: "",
    clearApiKey: false,
    customThinkingLevel: findCustomThinkingLevel(model.thinkingLevelOptions),
    originalId: model.id
  };
}

function applyDeepWriteFreeModel(modelId: string): void {
  const editor = modelEditor.value;
  const preset = deepwriteFreeModels.value.find((model) => model.id === modelId);
  if (!editor || !preset) {
    uiMessage.warning(
      props.modelSettings?.deepwriteFreeMessage ||
        "DeepWrite 免费模型配置暂时不可用，请稍后重试。"
    );
    return;
  }
  modelEditor.value = {
    ...preset,
    apiKey: "",
    clearApiKey: false,
    customThinkingLevel: findCustomThinkingLevel(preset.thinkingLevelOptions),
    ...(editor.originalId ? { originalId: editor.originalId } : {})
  };
}

function applyProviderPreset(provider: string): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  if (provider === "deepwrite-free") {
    const defaultModelId =
      props.modelSettings?.deepwriteFreeDefaultModelId ??
      deepwriteFreeModels.value[0]?.id;
    if (defaultModelId) {
      applyDeepWriteFreeModel(defaultModelId);
    } else {
      uiMessage.warning(
        props.modelSettings?.deepwriteFreeMessage ||
          "DeepWrite 免费模型配置暂时不可用，请稍后重试。"
      );
    }
    return;
  }
  const wasManaged = editor.managedBy === "deepwrite-free";
  delete editor.managedBy;
  if (wasManaged && !editor.originalId) {
    editor.id = createId("model");
  }
  if (wasManaged) {
    editor.label = "";
    editor.modelId = "";
    editor.hasApiKey = false;
    editor.apiKey = "";
    editor.clearApiKey = false;
  }
  editor.provider = provider;
  if (provider === "openai") {
    editor.api = "openai-responses";
    editor.baseUrl = "https://api.openai.com/v1";
  } else if (provider === "anthropic") {
    editor.api = "anthropic-messages";
    editor.baseUrl = "https://api.anthropic.com";
  } else if (provider === "deepseek") {
    editor.api = "openai-completions";
    editor.baseUrl = "https://api.deepseek.com/v1";
  } else if (provider === "google") {
    editor.api = "google-generative-ai";
    editor.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }
}

function setModelApi(value: string | number): void {
  if (modelEditor.value) {
    modelEditor.value.api = String(value) as ModelApi;
  }
}

function setDefaultThinkingLevel(value: string | number): void {
  if (modelEditor.value) {
    modelEditor.value.defaultThinkingLevel = String(value);
  }
}

function setModelMode(mode: "reasoning" | "temperature"): void {
  if (!modelEditor.value) {
    return;
  }
  const reasoning = mode === "reasoning";
  modelEditor.value.reasoning = reasoning;
  modelEditor.value.defaultThinkingLevel = reasoning
    ? modelEditor.value.thinkingLevelOptions.includes("medium")
      ? "medium"
      : modelEditor.value.thinkingLevelOptions[0] ?? "medium"
    : "off";
}

function toggleThinkingLevelOption(level: BuiltInReasoningLevel, event: Event): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  const input = event.target as HTMLInputElement;
  const checked = input.checked;
  if (!checked && editor.thinkingLevelOptions.length === 1) {
    input.checked = true;
    uiMessage.warning("思考模式至少需要保留一个思考等级。");
    return;
  }
  const selected = new Set(editor.thinkingLevelOptions);
  if (checked) {
    selected.add(level);
  } else {
    selected.delete(level);
  }
  const customLevel = findCustomThinkingLevel(editor.thinkingLevelOptions);
  editor.thinkingLevelOptions = reasoningOptions
    .map((option) => option.value)
    .filter((option) => selected.has(option)) as ThinkingLevelOptions;
  if (customLevel) {
    editor.thinkingLevelOptions.push(customLevel);
  }
  if (
    editor.reasoning &&
    !editor.thinkingLevelOptions.includes(editor.defaultThinkingLevel as ReasoningLevel)
  ) {
    editor.defaultThinkingLevel = editor.thinkingLevelOptions[0] ?? "medium";
  }
}

function updateCustomThinkingLevel(event: Event): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  const previousCustomLevel = findCustomThinkingLevel(editor.thinkingLevelOptions);
  const customWasDefault = previousCustomLevel === editor.defaultThinkingLevel;
  const rawValue = (event.target as HTMLInputElement).value;
  const customLevel = rawValue.trim();
  editor.customThinkingLevel = rawValue;
  editor.thinkingLevelOptions = editor.thinkingLevelOptions.filter(isBuiltInThinkingLevel);
  if (isValidCustomThinkingLevel(customLevel)) {
    editor.thinkingLevelOptions.push(customLevel);
  }
  if (customWasDefault) {
    editor.defaultThinkingLevel = isValidCustomThinkingLevel(customLevel)
      ? customLevel
      : editor.thinkingLevelOptions[0] ?? "medium";
  }
}

function saveModelEditor(): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  if (!editor.label.trim() || !editor.provider.trim() || !editor.modelId.trim()) {
    uiMessage.warning("请填写名称、Provider 和模型 ID。");
    return;
  }
  const customThinkingLevel = editor.customThinkingLevel?.trim() ?? "";
  if (customThinkingLevel && !isValidCustomThinkingLevel(customThinkingLevel)) {
    uiMessage.warning(
      "自定义思考等级不能与内置等级重复，且只能包含英文字母、数字、点、下划线或连字符。"
    );
    return;
  }
  if (
    !editor.reasoning &&
    (editor.temperatureOptions.some(
      (temperature) => !Number.isFinite(temperature) || temperature < 0 || temperature > 2
    ) ||
      new Set(editor.temperatureOptions).size !== editor.temperatureOptions.length)
  ) {
    uiMessage.warning("请填写 3 个不同的温度值，范围为 0 到 2。");
    return;
  }
  if (
    editor.reasoning &&
    (!editor.thinkingLevelOptions.length ||
      !editor.thinkingLevelOptions.includes(editor.defaultThinkingLevel as ReasoningLevel))
  ) {
    uiMessage.warning("请配置至少一个思考等级，并选择有效的默认等级。");
    return;
  }
  const {
    apiKey,
    customThinkingLevel: _customThinkingLevel,
    originalId,
    ...editorWithoutApiKey
  } = editor;
  const normalized: DraftModel = {
    ...editorWithoutApiKey,
    label: editor.label.trim(),
    provider: editor.provider.trim().toLowerCase(),
    modelId: editor.modelId.trim(),
    baseUrl: editor.baseUrl.trim(),
    defaultThinkingLevel: editor.reasoning ? editor.defaultThinkingLevel : "off",
    thinkingLevelOptions: cloneThinkingLevelOptions(editor.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(editor.temperatureOptions),
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
  };
  const index = draftModels.value.findIndex(
    (model) => model.id === (originalId ?? normalized.id)
  );
  const duplicateIndex = draftModels.value.findIndex(
    (model, candidateIndex) => model.id === normalized.id && candidateIndex !== index
  );
  if (duplicateIndex >= 0) {
    uiMessage.warning("这个 DeepWrite 免费模型已经添加过了。");
    return;
  }
  if (index >= 0) {
    draftModels.value[index] = normalized;
  } else {
    draftModels.value.push(normalized);
  }
  if (!draftDefaultModelId.value) {
    draftDefaultModelId.value = normalized.id;
  }
  modelEditor.value = null;
}

function toModelInput(model: DraftModel): ModelConfigInput {
  return {
    id: model.id,
    label: model.label.trim(),
    provider: model.provider.trim().toLowerCase(),
    modelId: model.modelId.trim(),
    api: model.api,
    baseUrl: model.baseUrl.trim(),
    reasoning: model.reasoning,
    defaultThinkingLevel: model.reasoning ? model.defaultThinkingLevel : "off",
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    ...(model.managedBy ? { managedBy: model.managedBy } : {}),
    ...(model.apiKey?.trim() ? { apiKey: model.apiKey.trim() } : {}),
    ...(model.clearApiKey ? { clearApiKey: true } : {})
  };
}

function testDraftModel(model: DraftModel): void {
  if (!model.label.trim() || !model.provider.trim() || !model.modelId.trim()) {
    uiMessage.warning("请先填写名称、Provider 和模型 ID，再测试连接。");
    return;
  }
  emit("testModel", toModelInput(model));
}

function removeModel(modelId: string): void {
  draftModels.value = draftModels.value.filter((model) => model.id !== modelId);
  if (draftDefaultModelId.value === modelId) {
    draftDefaultModelId.value = draftModels.value[0]?.id ?? "";
  }
  if (modelEditor.value?.id === modelId) {
    modelEditor.value = null;
  }
}

function setDefaultModel(modelId: string): void {
  draftDefaultModelId.value = modelId;
}

function submitModelSettings(): void {
  const models: ModelConfigInput[] = draftModels.value.map(toModelInput);
  emit("saveModels", {
    models,
    defaultModelId: draftDefaultModelId.value || models[0]?.id || ""
  });
}

function discardModelChanges(): void {
  resetModelDraft(props.modelSettings);
}
</script>

<template>
      <section
        class="workspace-settings-panel"
        :class="{ 'is-model-config': mode === 'models' }"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2>
              {{
                mode === "directory"
                  ? "工作目录"
                  : mode === "models"
                    ? "模型配置"
                    : "模型配置"
              }}
            </h2>
          </div>
        </header>

        <div v-if="mode === 'directory'" class="dialog-content">
          <p class="dialog-description">这里决定以后新建和导入项目的默认位置。切换目录不会移动或影响已经打开的书籍、素材库和技能库。</p>
          <div class="directory-card">
            <AppIcon name="directory" :size="20" />
            <div>
              <strong>{{ workspaceDirectoryPath ? "当前工作目录" : "尚未选择工作目录" }}</strong>
              <code>{{ workspaceDirectoryPath ?? "首次创建或导入时也会提示选择" }}</code>
            </div>
            <span>{{ workspaceDirectoryPath ? "已启用" : "待设置" }}</span>
          </div>
          <div class="dialog-note">新书和旧版导入保存在 books，新素材库保存在 materials，新技能库保存在 skills。项目仍采用 deepwrite.json + Markdown 文件结构，可由 Git 或同步盘直接管理。</div>
          <div class="dialog-actions">
            <button
              class="dialog-primary-button"
              type="button"
              :disabled="workspaceDirectoryLoading"
              @click="emit('chooseWorkspaceDirectory')"
            >
              {{ workspaceDirectoryLoading ? "选择中…" : workspaceDirectoryPath ? "切换工作目录" : "选择工作目录" }}
            </button>
          </div>
        </div>

        <div v-else-if="mode === 'models'" class="dialog-content model-config-content">
          <div class="model-config-scroll-area">
            <p class="dialog-description">
              配置会同时用于连接测试与实际对话。API Key 仅由 Main 进程通过系统安全存储加密保存，Renderer 不会读回明文。
            </p>

            <div v-if="modelLoading" class="dialog-note">正在读取模型配置…</div>
            <template v-else>
              <section v-if="modelEditor" class="model-editor">
                <div class="model-editor-heading">
                  <strong>{{ draftModels.some((model) => model.id === (modelEditor?.originalId ?? modelEditor?.id)) ? "编辑模型" : "添加模型" }}</strong>
                  <button type="button" @click="modelEditor = null">取消</button>
                </div>
                <div class="model-form-grid">
                  <label>
                    <span>名称</span>
                    <input
                      v-model="modelEditor.label"
                      type="text"
                      placeholder="例如：DeepSeek 写作"
                      :readonly="isDeepWriteFreeEditor"
                    />
                  </label>
                  <label>
                    <span>Provider</span>
                    <PopupSelect
                      :model-value="isDeepWriteFreeEditor ? 'deepwrite-free' : modelEditor.provider"
                      :options="providerOptions"
                      accessible-label="选择 Provider"
                      @update:model-value="applyProviderPreset(String($event))"
                    />
                  </label>
                  <label>
                    <span>模型 ID</span>
                    <PopupSelect
                      v-if="isDeepWriteFreeEditor"
                      :model-value="modelEditor.id"
                      :options="deepwriteFreeModelOptions"
                      accessible-label="选择 DeepWrite 免费模型"
                      :menu-min-width="300"
                      @update:model-value="applyDeepWriteFreeModel(String($event))"
                    />
                    <input
                      v-else
                      v-model="modelEditor.modelId"
                      type="text"
                      placeholder="服务商提供的模型 ID"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor">
                    <span>API 类型</span>
                    <PopupSelect
                      :model-value="modelEditor.api"
                      :options="apiOptions"
                      accessible-label="选择 API 类型"
                      :menu-min-width="240"
                      @update:model-value="setModelApi"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor" class="is-wide">
                    <span>API 地址</span>
                    <input v-model="modelEditor.baseUrl" type="url" placeholder="内置模型可留空，自定义服务请填写" />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor" class="is-wide">
                    <span>API Key</span>
                    <input
                      v-model="modelEditor.apiKey"
                      type="password"
                      :placeholder="modelEditor.hasApiKey ? '已安全保存；留空表示保持不变' : '请输入 API Key（本地服务可留空）'"
                      autocomplete="new-password"
                      @input="modelEditor.clearApiKey = false"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor">
                    <span>模型模式</span>
                    <PopupSelect
                      :model-value="modelEditor.reasoning ? 'reasoning' : 'temperature'"
                      :options="modelModeOptions"
                      accessible-label="选择模型模式"
                      @update:model-value="setModelMode(String($event) as 'reasoning' | 'temperature')"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor && modelEditor.reasoning">
                    <span>默认思考等级</span>
                    <PopupSelect
                      :model-value="modelEditor.defaultThinkingLevel"
                      :options="defaultThinkingOptions"
                      accessible-label="选择默认思考等级"
                      @update:model-value="setDefaultThinkingLevel"
                    />
                  </label>
                  <label v-else-if="!isDeepWriteFreeEditor">
                    <span class="model-field-label">
                      温度选项
                      <span
                        class="model-help-icon"
                        tabindex="0"
                        aria-label="温度说明：温度越低，输出越稳定和确定；温度越高，表达越多样和有创造性。可填写 0 到 2。"
                        data-tooltip="温度越低，输出越稳定、确定；温度越高，表达越多样、有创造性。可填写 0–2。"
                      >!</span>
                    </span>
                    <span class="model-temperature-options">
                      <input
                        v-for="(_, index) in modelEditor.temperatureOptions"
                        :key="index"
                        v-model.number="modelEditor.temperatureOptions[index]"
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        :aria-label="`温度选项 ${index + 1}`"
                      />
                    </span>
                  </label>
                  <label v-if="!isDeepWriteFreeEditor && modelEditor.reasoning" class="is-wide">
                    <span>思考等级选项</span>
                    <span class="model-thinking-options">
                      <label
                        v-for="option in reasoningOptions"
                        :key="option.value"
                        class="model-thinking-option"
                        tabindex="0"
                        :title="option.value"
                        :data-tooltip="option.value"
                      >
                        <input
                          type="checkbox"
                          :checked="modelEditor.thinkingLevelOptions.includes(option.value)"
                          @change="toggleThinkingLevelOption(option.value, $event)"
                        />
                        <span>{{ option.label }}</span>
                      </label>
                      <span
                        class="model-custom-thinking"
                        :title="modelEditor.customThinkingLevel?.trim() || 'custom'"
                        :data-tooltip="modelEditor.customThinkingLevel?.trim() || 'custom'"
                      >
                        <span>自定义</span>
                        <input
                          :value="modelEditor.customThinkingLevel"
                          type="text"
                          maxlength="64"
                          placeholder="例如 ultra"
                          aria-label="自定义思考等级英文值"
                          @input="updateCustomThinkingLevel"
                        />
                      </span>
                    </span>
                  </label>
                  <p v-if="isDeepWriteFreeEditor" class="model-managed-note is-wide">
                    模型名称和参数由 DeepWrite 远程配置自动维护；运行环境提供密钥，无需在此填写。
                  </p>
                </div>
                <div
                  v-if="modelEditor.hasApiKey && !isDeepWriteFreeEditor"
                  class="model-key-row"
                >
                  <span>已有密钥会保持不变。</span>
                  <button
                    type="button"
                    @click="modelEditor.hasApiKey = false; modelEditor.clearApiKey = true; modelEditor.apiKey = ''"
                  >
                    清除已保存密钥
                  </button>
                </div>
                <div class="dialog-actions">
                  <button
                    class="dialog-secondary-button"
                    type="button"
                    :disabled="testingModelId !== null"
                    @click="testDraftModel(modelEditor)"
                  >
                    {{ testingModelId === modelEditor.id ? "测试中…" : "测试当前填写" }}
                  </button>
                  <button class="dialog-primary-button" type="button" @click="saveModelEditor">
                    应用到配置
                  </button>
                </div>
              </section>

              <div v-if="draftModels.length === 0" class="model-empty-state">
                <strong>尚未配置真实模型</strong>
                <span>当前对话继续使用 DeepWrite Faux。添加模型并设为默认后，新的请求会走真实 Provider。</span>
              </div>

              <article
                v-for="model in draftModels"
                :key="model.id"
                class="model-card model-config-card"
                :class="{ 'is-default': draftDefaultModelId === model.id }"
              >
              <span class="model-logo">{{ model.label.slice(0, 1).toUpperCase() }}</span>
              <div>
                <strong>{{ model.label }}</strong>
                <small>{{ model.managedBy === "deepwrite-free" ? "DeepWrite 免费模型" : model.provider }} · {{ model.modelId }} · {{ model.api }}</small>
                <small>
                  {{ model.reasoning ? `思考：${model.thinkingLevelOptions.map(thinkingLabel).join(" / ")}（默认 ${thinkingLabel(model.defaultThinkingLevel)}）` : `温度：${model.temperatureOptions.join(" / ")}` }} ·
                  {{ model.hasApiKey || model.apiKey ? "密钥已配置" : "未配置密钥" }}
                </small>
              </div>
              <div class="model-card-actions">
                <button
                  type="button"
                  :class="{ 'is-active': draftDefaultModelId === model.id }"
                  @click="setDefaultModel(model.id)"
                >
                  {{ draftDefaultModelId === model.id ? "默认" : "设为默认" }}
                </button>
                <button type="button" @click="editModel(model)">编辑</button>
                <button
                  type="button"
                  :disabled="testingModelId !== null"
                  title="使用当前未保存的配置测试连接"
                  @click="testDraftModel(model)"
                >
                  {{ testingModelId === model.id ? "测试中…" : "测试连接" }}
                </button>
                <button class="is-danger" type="button" @click="removeModel(model.id)">删除</button>
              </div>
              </article>

              <button
                v-if="!modelEditor"
                class="dialog-secondary-button model-add-button"
                type="button"
                @click="createModel"
              >
                <AppIcon name="plus" :size="15" />添加模型
              </button>
            </template>
          </div>

          <div v-if="!modelLoading" class="dialog-actions model-save-actions">
            <button class="dialog-secondary-button" type="button" @click="discardModelChanges">还原未保存</button>
            <button
              class="dialog-primary-button"
              type="button"
              :disabled="modelSaving || Boolean(modelEditor)"
              @click="submitModelSettings"
            >
              {{ modelSaving ? "保存中…" : "保存模型配置" }}
            </button>
          </div>
        </div>

      </section>
</template>
