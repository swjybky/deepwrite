<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ModelConfigInput } from "@deepwrite/contracts";
import {
  useModelEditor,
  type ModelEditorSavePayload
} from "../composables/useModelEditor";
import type { DraftModel } from "./modelSettingsDraft";
import PopupSelect from "./PopupSelect.vue";

const props = defineProps<{
  model: DraftModel;
  editing: boolean;
  saving: boolean;
  testingModelId: string | null;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [payload: ModelEditorSavePayload];
  test: [model: ModelConfigInput];
}>();

const fetchHintConfirmButton = ref<HTMLButtonElement | null>(null);
const {
  editor,
  reasoningOptions,
  providerOptions,
  apiOptions,
  toolSchemaProfileOptions,
  modelModeOptions,
  defaultThinkingOptions,
  canSelectRemoteModel,
  remoteModelOptions,
  listingRemoteModels,
  fetchHintDialog,
  setFetchedModelId,
  fetchRemoteModels,
  applyProviderPreset,
  setModelApi,
  setToolSchemaProfile,
  setDefaultThinkingLevel,
  setModelMode,
  toggleThinkingLevelOption,
  updateCustomThinkingLevel,
  save,
  test
} = useModelEditor(props.model, {
  save: (payload) => emit("save", payload),
  test: (model) => emit("test", model)
});

watch(fetchHintDialog, (message) => {
  if (message) void nextTick(() => fetchHintConfirmButton.value?.focus());
});
</script>

<template>
  <section class="model-editor" :inert="saving">
    <div class="model-editor-heading">
      <strong>{{ editing ? "编辑模型" : "添加模型" }}</strong>
      <button type="button" @click="emit('cancel')">取消</button>
    </div>
    <div class="model-form-grid">
      <label>
        <span>名称</span>
        <input
          v-model="editor.label"
          type="text"
          placeholder="例如：DeepSeek 写作"
        />
      </label>
      <label>
        <span>Provider</span>
        <PopupSelect
          :model-value="editor.provider"
          :options="providerOptions"
          accessible-label="选择 Provider"
          @update:model-value="applyProviderPreset(String($event))"
        />
      </label>
      <label>
        <span>模型 ID</span>
        <div class="model-id-field">
          <PopupSelect
            v-if="canSelectRemoteModel"
            :model-value="editor.modelId"
            :options="remoteModelOptions"
            accessible-label="选择模型 ID"
            placeholder="请选择模型 ID"
            :menu-min-width="280"
            :disabled="listingRemoteModels"
            @update:model-value="setFetchedModelId"
          />
          <input
            v-else
            v-model="editor.modelId"
            type="text"
            placeholder="服务商提供的模型 ID"
          />
          <button
            class="model-id-fetch-button"
            type="button"
            :disabled="listingRemoteModels"
            :title="
              listingRemoteModels
                ? '拉取中…'
                : '根据 API 地址和 Key 拉取可用模型'
            "
            :aria-label="listingRemoteModels ? '拉取中' : '拉取可用模型'"
            @click="fetchRemoteModels"
          >
            {{ listingRemoteModels ? "拉取中" : "拉取" }}
          </button>
        </div>
      </label>
      <label>
        <span>API 类型</span>
        <PopupSelect
          :model-value="editor.api"
          :options="apiOptions"
          accessible-label="选择 API 类型"
          :menu-min-width="240"
          @update:model-value="setModelApi"
        />
      </label>
      <label>
        <span>API 地址</span>
        <input
          v-model="editor.baseUrl"
          type="url"
          placeholder="内置模型可留空，自定义服务请填写"
        />
      </label>
      <label>
        <span>工具结构</span>
        <PopupSelect
          :model-value="editor.toolSchemaProfile ?? 'auto'"
          :options="toolSchemaProfileOptions"
          accessible-label="选择工具结构兼容模式"
          :menu-min-width="300"
          @update:model-value="setToolSchemaProfile"
        />
      </label>
      <label class="is-wide">
        <span>API Key</span>
        <input
          v-model="editor.apiKey"
          type="password"
          :placeholder="
            editor.hasApiKey
              ? '已安全保存；留空表示保持不变'
              : '请输入 API Key（本地服务可留空）'
          "
          autocomplete="new-password"
          @input="editor.clearApiKey = false"
        />
      </label>
      <label>
        <span>模型模式</span>
        <PopupSelect
          :model-value="editor.reasoning ? 'reasoning' : 'temperature'"
          :options="modelModeOptions"
          accessible-label="选择模型模式"
          @update:model-value="
            setModelMode(String($event) as 'reasoning' | 'temperature')
          "
        />
      </label>
      <label v-if="editor.reasoning">
        <span>默认思考等级</span>
        <PopupSelect
          :model-value="editor.defaultThinkingLevel"
          :options="defaultThinkingOptions"
          accessible-label="选择默认思考等级"
          @update:model-value="setDefaultThinkingLevel"
        />
      </label>
      <label v-else>
        <span class="model-field-label">
          温度选项
          <span
            class="model-help-icon"
            tabindex="0"
            aria-label="温度说明：温度越低，输出越稳定和确定；温度越高，表达越多样和有创造性。可填写 0 到 2。"
            data-tooltip="温度越低，输出越稳定、确定；温度越高，表达越多样、有创造性。可填写 0–2。"
            >!</span
          >
        </span>
        <span class="model-temperature-options">
          <input
            v-for="(_, index) in editor.temperatureOptions"
            :key="index"
            v-model.number="editor.temperatureOptions[index]"
            type="number"
            min="0"
            max="2"
            step="0.1"
            :aria-label="`温度选项 ${index + 1}`"
          />
        </span>
      </label>
      <label v-if="editor.reasoning" class="is-wide">
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
              :checked="editor.thinkingLevelOptions.includes(option.value)"
              @change="toggleThinkingLevelOption(option.value, $event)"
            />
            <span>{{ option.label }}</span>
          </label>
          <span
            class="model-custom-thinking"
            :title="editor.customThinkingLevel?.trim() || 'custom'"
            :data-tooltip="editor.customThinkingLevel?.trim() || 'custom'"
          >
            <span>自定义</span>
            <input
              :value="editor.customThinkingLevel"
              type="text"
              maxlength="64"
              placeholder="例如 ultra"
              aria-label="自定义思考等级英文值"
              @input="updateCustomThinkingLevel"
            />
          </span>
        </span>
      </label>
    </div>

    <div v-if="editor.hasApiKey" class="model-key-row">
      <span>已有密钥会保持不变。</span>
      <button
        type="button"
        @click="
          editor.hasApiKey = false;
          editor.clearApiKey = true;
          editor.apiKey = '';
        "
      >
        清除已保存密钥
      </button>
    </div>
    <div class="dialog-actions">
      <button
        class="dialog-secondary-button"
        type="button"
        :disabled="testingModelId !== null"
        @click="test"
      >
        {{ testingModelId === editor.id ? "测试中…" : "测试当前填写" }}
      </button>
      <button class="dialog-primary-button" type="button" @click="save">
        {{ saving ? "保存中…" : "应用并保存配置" }}
      </button>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="fetchHintDialog"
      class="dialog-backdrop model-fetch-hint-overlay"
      @mousedown.self="fetchHintDialog = null"
      @keydown.esc.stop="fetchHintDialog = null"
    >
      <section
        class="model-fetch-hint-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="model-fetch-hint-title"
        aria-describedby="model-fetch-hint-message"
        tabindex="-1"
        @keydown.esc.stop="fetchHintDialog = null"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">模型配置</span>
            <h2 id="model-fetch-hint-title">无法拉取模型</h2>
          </div>
        </header>
        <p id="model-fetch-hint-message">{{ fetchHintDialog }}</p>
        <footer class="dialog-actions">
          <button
            ref="fetchHintConfirmButton"
            class="dialog-primary-button"
            type="button"
            @click="fetchHintDialog = null"
          >
            知道了
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
