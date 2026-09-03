<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  isDeepWriteSiteOfficialModel,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import { useModelSettingsDraft } from "../composables/useModelSettingsDraft";
import AppIcon from "./AppIcon.vue";
import ModelAdvancedConfigDialog from "./ModelAdvancedConfigDialog.vue";
import ModelEditorPanel from "./ModelEditorPanel.vue";
import { thinkingLabel } from "./modelSettingsDraft";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    modelScope?: "all" | "custom";
    embedded?: boolean;
    modelSettings: ModelSettings | null;
    modelLoading: boolean;
    modelSaving: boolean;
    modelError: string | null;
    modelTestMessage: string | null;
    testingModelId: string | null;
    modelAlertMessages: readonly string[];
  }>(),
  {
    active: false,
    modelScope: "all",
    embedded: false
  }
);

const emit = defineEmits<{
  saveModels: [settings: ModelSettingsInput];
  testModel: [model: ModelConfigInput];
  openOfficialModels: [];
}>();

const modelConfigScrollArea = ref<HTMLElement | null>(null);
function scrollModelEditorIntoView(): void {
  void nextTick(() => {
    modelConfigScrollArea.value
      ?.querySelector<HTMLElement>(".model-editor")
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  });
}

const {
  draftModels,
  draftDefaultModelId,
  modelEditor,
  advancedConfigModel,
  modelConfigRows,
  createModel,
  editModel,
  saveModelEditor,
  testDraftModel,
  removeModel,
  openAdvancedConfig,
  closeAdvancedConfig,
  saveAdvancedConfig,
  setDefaultModel,
  submitModelSettings,
  discardModelChanges
} = useModelSettingsDraft(props, {
  saveModels: (settings) => emit("saveModels", settings),
  testModel: (model) => emit("testModel", model),
  editorOpened: scrollModelEditorIntoView
});
</script>

<template>
  <section
    class="workspace-settings-panel is-model-config"
    :class="{ 'is-embedded': embedded }"
  >
    <header v-if="!embedded">
      <div>
        <span class="dialog-eyebrow">DeepWrite</span>
        <h2>模型配置</h2>
      </div>
    </header>

    <div class="dialog-content model-config-content">
      <div ref="modelConfigScrollArea" class="model-config-scroll-area">
        <div
          v-if="modelScope === 'all' && modelAlertMessages.length > 0"
          class="dialog-description model-price-notice"
          aria-label="模型公告"
        >
          <button
            v-for="(message, index) in modelAlertMessages"
            :key="`${index}:${message}`"
            class="model-price-notice-link"
            type="button"
            title="前往设置官方模型"
            @click="emit('openOfficialModels')"
          >
            {{ message }}
          </button>
        </div>

        <div v-if="modelLoading" class="dialog-note">正在读取模型配置…</div>
        <template v-else>
          <div v-if="draftModels.length === 0" class="model-empty-state">
            <strong>{{
              modelScope === "custom"
                ? "尚未配置自定义模型"
                : "尚未配置真实模型"
            }}</strong>
            <span>{{
              modelScope === "custom"
                ? "添加自定义模型后，可在这里测试连接、维护密钥并设为全局默认模型。"
                : "当前对话继续使用 DeepWrite Faux。添加模型并设为默认后，新的请求会走真实 Provider。"
            }}</span>
          </div>

          <template v-for="row in modelConfigRows" :key="row.key">
            <ModelEditorPanel
              v-if="row.type === 'editor' && modelEditor"
              :model="modelEditor"
              :editing="Boolean(modelEditor.originalId)"
              :testing-model-id="testingModelId"
              @cancel="modelEditor = null"
              @save="saveModelEditor"
              @test="emit('testModel', $event)"
            />

            <article
              v-else-if="row.type === 'model'"
              class="model-card model-config-card"
              :class="{ 'is-default': draftDefaultModelId === row.model.id }"
            >
              <span class="model-logo">{{
                row.model.label.slice(0, 1).toUpperCase()
              }}</span>
              <div>
                <strong>{{ row.model.label }}</strong>
                <small>
                  {{
                    row.model.managedBy === "deepwrite-official"
                      ? "旧官方小站模型"
                      : row.model.managedBy === "deepwrite-free"
                        ? isDeepWriteSiteOfficialModel(row.model)
                          ? "新官方小站模型"
                          : "DeepWrite 免费模型"
                        : row.model.provider
                  }}
                  · {{ row.model.modelId }} · {{ row.model.api }}
                </small>
                <small>
                  {{
                    row.model.reasoning
                      ? `思考：${row.model.thinkingLevelOptions.map(thinkingLabel).join(" / ")}（默认 ${thinkingLabel(row.model.defaultThinkingLevel)}）`
                      : `温度：${row.model.temperatureOptions.join(" / ")}`
                  }}
                  ·
                  {{
                    row.model.hasApiKey || row.model.apiKey
                      ? "密钥已配置"
                      : row.model.managedBy
                        ? "托管接入"
                        : "未配置密钥"
                  }}
                </small>
              </div>
              <div class="model-card-actions">
                <button
                  type="button"
                  :class="{ 'is-active': draftDefaultModelId === row.model.id }"
                  :disabled="modelSaving || Boolean(modelEditor)"
                  @click="setDefaultModel(row.model.id)"
                >
                  {{
                    modelSaving && draftDefaultModelId === row.model.id
                      ? "保存中…"
                      : draftDefaultModelId === row.model.id
                        ? "默认"
                        : "设为默认"
                  }}
                </button>
                <button
                  v-if="!row.model.managedBy"
                  type="button"
                  @click="editModel(row.model)"
                >
                  编辑
                </button>
                <button
                  type="button"
                  :disabled="testingModelId !== null"
                  title="使用当前未保存的配置测试连接"
                  @click="testDraftModel(row.model)"
                >
                  {{ testingModelId === row.model.id ? "测试中…" : "测试连接" }}
                </button>
                <button
                  v-if="!row.model.managedBy"
                  type="button"
                  :disabled="modelSaving || Boolean(modelEditor)"
                  title="配置上下文长度和最高输出长度"
                  @click="openAdvancedConfig(row.model)"
                >
                  高级配置
                </button>
                <button
                  v-if="!row.model.managedBy"
                  class="is-danger"
                  type="button"
                  @click="removeModel(row.model.id)"
                >
                  删除
                </button>
              </div>
            </article>
          </template>

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
        <button
          class="dialog-secondary-button"
          type="button"
          @click="discardModelChanges"
        >
          还原未保存
        </button>
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

  <ModelAdvancedConfigDialog
    :model="advancedConfigModel"
    :busy="modelSaving"
    @close="closeAdvancedConfig"
    @save="saveAdvancedConfig"
  />
</template>
