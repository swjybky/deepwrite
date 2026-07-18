<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  ModelConfig,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ThinkingLevel
} from "@deepwrite/contracts";
import type { DialogMode } from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

interface DraftModel extends ModelConfig {
  apiKey?: string;
  clearApiKey?: boolean;
}

const props = defineProps<{
  mode: DialogMode | null;
  modelSettings: ModelSettings | null;
  modelLoading: boolean;
  modelSaving: boolean;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
}>();
const emit = defineEmits<{
  close: [];
  seedPrompt: [value: string];
  saveModels: [settings: ModelSettingsInput];
  testModel: [modelId: string];
}>();

const imitationSample = ref("");
const draftModels = ref<DraftModel[]>([]);
const draftDefaultModelId = ref("");
const modelEditor = ref<DraftModel | null>(null);
const modelDirty = ref(false);

const thinkingOptions: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "最低" },
  { value: "low", label: "较低" },
  { value: "medium", label: "标准" },
  { value: "high", label: "深度" },
  { value: "xhigh", label: "极高" }
];

function thinkingLabel(level: ThinkingLevel): string {
  return thinkingOptions.find((option) => option.value === level)?.label ?? level;
}

function resetModelDraft(settings: ModelSettings | null): void {
  draftModels.value = (settings?.models ?? []).map((model) => ({ ...model }));
  draftDefaultModelId.value = settings?.defaultModelId ?? "";
  modelEditor.value = null;
  modelDirty.value = false;
}

watch(
  () => props.mode,
  (mode) => {
    if (mode !== "imitation") {
      imitationSample.value = "";
    }
    if (mode === "models") {
      resetModelDraft(props.modelSettings);
    }
  }
);

watch(
  () => [props.modelSettings, props.modelSaving] as const,
  ([settings, saving]) => {
    if (props.mode === "models" && !saving) {
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

function addImitationContext(): void {
  const sample = imitationSample.value.trim();
  emit(
    "seedPrompt",
    sample
      ? `请分析下面文字的语言风格，并在不复用原句的前提下仿写：\n\n${sample}`
      : "请分析一段参考文字的语言风格，并建立可复用的仿写规则。"
  );
}

function createModel(): void {
  modelEditor.value = {
    id: `model_${globalThis.crypto.randomUUID()}`,
    label: "",
    provider: "deepseek",
    modelId: "",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    hasApiKey: false,
    apiKey: ""
  };
}

function editModel(model: DraftModel): void {
  modelEditor.value = { ...model, apiKey: "", clearApiKey: false };
}

function applyProviderPreset(provider: string): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
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

function toggleReasoning(reasoning: boolean): void {
  if (!modelEditor.value) {
    return;
  }
  modelEditor.value.reasoning = reasoning;
  modelEditor.value.defaultThinkingLevel = reasoning ? "medium" : "off";
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
  const { apiKey, ...editorWithoutApiKey } = editor;
  const normalized: DraftModel = {
    ...editorWithoutApiKey,
    label: editor.label.trim(),
    provider: editor.provider.trim().toLowerCase(),
    modelId: editor.modelId.trim(),
    baseUrl: editor.baseUrl.trim(),
    defaultThinkingLevel: editor.reasoning ? editor.defaultThinkingLevel : "off",
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
  };
  const index = draftModels.value.findIndex((model) => model.id === normalized.id);
  if (index >= 0) {
    draftModels.value[index] = normalized;
  } else {
    draftModels.value.push(normalized);
  }
  if (!draftDefaultModelId.value) {
    draftDefaultModelId.value = normalized.id;
  }
  modelEditor.value = null;
  modelDirty.value = true;
}

function removeModel(modelId: string): void {
  draftModels.value = draftModels.value.filter((model) => model.id !== modelId);
  if (draftDefaultModelId.value === modelId) {
    draftDefaultModelId.value = draftModels.value[0]?.id ?? "";
  }
  if (modelEditor.value?.id === modelId) {
    modelEditor.value = null;
  }
  modelDirty.value = true;
}

function setDefaultModel(modelId: string): void {
  draftDefaultModelId.value = modelId;
  modelDirty.value = true;
}

function submitModelSettings(): void {
  const models: ModelConfigInput[] = draftModels.value.map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    modelId: model.modelId,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    defaultThinkingLevel: model.defaultThinkingLevel,
    ...(model.apiKey ? { apiKey: model.apiKey } : {}),
    ...(model.clearApiKey ? { clearApiKey: true } : {})
  }));
  emit("saveModels", {
    models,
    defaultModelId: draftDefaultModelId.value || models[0]?.id || ""
  });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="mode" class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="workspace-dialog"
        :class="{ 'is-model-config': mode === 'models' }"
        role="dialog"
        aria-modal="true"
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
                    : "学习仿写"
              }}
            </h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div v-if="mode === 'directory'" class="dialog-content">
          <p class="dialog-description">新客户端已为旧项目迁移预留独立工作目录边界。</p>
          <div class="directory-card">
            <AppIcon name="directory" :size="20" />
            <div>
              <strong>当前迁移来源</strong>
              <code>/home/swj/project/swj/yonquan-write/write-claw</code>
            </div>
            <span>已识别</span>
          </div>
          <div class="dialog-note">第一阶段仅建立界面与进程边界，不读取或改写旧项目数据。</div>
        </div>

        <div v-else-if="mode === 'models'" class="dialog-content model-config-content">
          <p class="dialog-description">
            配置会同时用于连接测试与实际对话。API Key 仅由 Main 进程通过系统安全存储加密保存，Renderer 不会读回明文。
          </p>

          <div v-if="modelLoading" class="dialog-note">正在读取模型配置…</div>
          <template v-else>
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
                <small>{{ model.provider }} · {{ model.modelId }} · {{ model.api }}</small>
                <small>
                  默认思考：{{ thinkingLabel(model.defaultThinkingLevel) }} ·
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
                  :disabled="modelDirty || testingModelId !== null"
                  :title="modelDirty ? '请先保存配置再测试' : '使用实际对话链路测试连接'"
                  @click="emit('testModel', model.id)"
                >
                  {{ testingModelId === model.id ? "测试中…" : "测试连接" }}
                </button>
                <button class="is-danger" type="button" @click="removeModel(model.id)">删除</button>
              </div>
            </article>

            <section v-if="modelEditor" class="model-editor">
              <div class="model-editor-heading">
                <strong>{{ draftModels.some((model) => model.id === modelEditor?.id) ? "编辑模型" : "添加模型" }}</strong>
                <button type="button" @click="modelEditor = null">取消</button>
              </div>
              <div class="model-form-grid">
                <label>
                  <span>名称</span>
                  <input v-model="modelEditor.label" type="text" placeholder="例如：DeepSeek 写作" />
                </label>
                <label>
                  <span>Provider</span>
                  <select
                    :value="modelEditor.provider"
                    @change="applyProviderPreset(($event.target as HTMLSelectElement).value)"
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="custom">其他兼容服务</option>
                  </select>
                </label>
                <label>
                  <span>模型 ID</span>
                  <input v-model="modelEditor.modelId" type="text" placeholder="服务商提供的模型 ID" />
                </label>
                <label>
                  <span>API 类型</span>
                  <select v-model="modelEditor.api">
                    <option value="openai-completions">OpenAI Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                    <option value="google-generative-ai">Google Generative AI</option>
                  </select>
                </label>
                <label class="is-wide">
                  <span>API 地址</span>
                  <input v-model="modelEditor.baseUrl" type="url" placeholder="内置模型可留空，自定义服务请填写" />
                </label>
                <label class="is-wide">
                  <span>API Key</span>
                  <input
                    v-model="modelEditor.apiKey"
                    type="password"
                    :placeholder="modelEditor.hasApiKey ? '已安全保存；留空表示保持不变' : '请输入 API Key（本地服务可留空）'"
                    autocomplete="new-password"
                    @input="modelEditor.clearApiKey = false"
                  />
                </label>
                <label class="model-reasoning-toggle">
                  <span>支持思考</span>
                  <input
                    :checked="modelEditor.reasoning"
                    type="checkbox"
                    @change="toggleReasoning(($event.target as HTMLInputElement).checked)"
                  />
                </label>
                <label>
                  <span>默认思考等级</span>
                  <select
                    v-model="modelEditor.defaultThinkingLevel"
                    :disabled="!modelEditor.reasoning"
                  >
                    <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>
              <div v-if="modelEditor.hasApiKey" class="model-key-row">
                <span>已有密钥会保持不变。</span>
                <button
                  type="button"
                  @click="modelEditor.hasApiKey = false; modelEditor.clearApiKey = true; modelEditor.apiKey = ''"
                >
                  清除已保存密钥
                </button>
              </div>
              <div class="dialog-actions">
                <button class="dialog-primary-button" type="button" @click="saveModelEditor">
                  应用到配置
                </button>
              </div>
            </section>

            <button
              v-else
              class="dialog-secondary-button model-add-button"
              type="button"
              @click="createModel"
            >
              <AppIcon name="plus" :size="15" />添加模型
            </button>

            <div class="dialog-actions model-save-actions">
              <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
              <button
                class="dialog-primary-button"
                type="button"
                :disabled="modelSaving || Boolean(modelEditor)"
                @click="submitModelSettings"
              >
                {{ modelSaving ? "保存中…" : "保存模型配置" }}
              </button>
            </div>
          </template>
        </div>

        <div v-else-if="mode === 'imitation'" class="dialog-content">
          <p class="dialog-description">粘贴参考文字，把风格分析任务发送到中间智能体对话。</p>
          <textarea v-model="imitationSample" rows="8" placeholder="在这里粘贴参考文本……" />
          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
            <button class="dialog-primary-button" type="button" @click="addImitationContext">
              <AppIcon name="wand" :size="15" />添加到对话
            </button>
          </div>
        </div>

      </section>
    </div>
  </Teleport>
</template>
