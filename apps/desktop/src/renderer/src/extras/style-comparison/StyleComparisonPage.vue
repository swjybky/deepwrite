<script setup lang="ts">
import { computed, watch } from "vue";
import type { ModelConfig } from "@deepwrite/contracts";
import {
  STYLE_COMPARISON_TEXT_LIMIT,
  STYLE_COMPARISON_METHOD_LIMIT
} from "@deepwrite/contracts/renderer";
import { DEFAULT_STYLE_COMPARISON_METHOD } from "./method";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { thinkingLabel } from "../../components/modelSettingsDraft";
import { uiMessage } from "../../ui-feedback";
import { useStyleComparisonStore } from "./store";
import StyleComparisonResult from "./StyleComparisonResult.vue";
import "./style-comparison.css";

const props = defineProps<{
  models: readonly ModelConfig[];
  preferredModelId: string | null;
}>();
const comparison = useStyleComparisonStore();
const availableModels = computed(() =>
  props.models.filter((model) => model.enabled !== false)
);
const modelOptions = computed(() =>
  availableModels.value.map((model) => ({
    value: model.id,
    label: model.label
  }))
);
watch(
  () =>
    [availableModels.value, props.preferredModelId, comparison.isBusy] as const,
  () => {
    if (
      comparison.isBusy ||
      availableModels.value.some((model) => model.id === comparison.modelId)
    )
      return;
    comparison.modelId =
      availableModels.value.find((model) => model.id === props.preferredModelId)
        ?.id ??
      availableModels.value[0]?.id ??
      "";
  },
  { immediate: true }
);
const selectedModel = computed(() =>
  availableModels.value.find((model) => model.id === comparison.modelId)
);
const thinkingOptions = computed(() =>
  ["off", ...(selectedModel.value?.thinkingLevelOptions ?? [])].map(
    (value) => ({
      value,
      label: thinkingLabel(value)
    })
  )
);
watch(
  () => [selectedModel.value, comparison.isBusy] as const,
  () => comparison.syncThinkingModel(selectedModel.value),
  { immediate: true, flush: "sync" }
);
const canStart = computed(() =>
  Boolean(
    comparison.referenceText.trim() &&
    comparison.comparisonText.trim() &&
    selectedModel.value
  )
);
function start(): void {
  void comparison.start(selectedModel.value);
}
function restoreMethod(): void {
  comparison.method = DEFAULT_STYLE_COMPARISON_METHOD;
  uiMessage.success("已恢复默认比对方法。");
}
</script>

<template>
  <section class="style-comparison-page" aria-label="文风比对工作台">
    <header class="comparison-page-header">
      <div>
        <p class="comparison-eyebrow">更多功能</p>
        <h1>文风比对</h1>
        <p>放入两份文本，看看它们写得有多像。</p>
      </div>
      <span class="comparison-header-note"
        ><AppIcon name="file" :size="16" />从表达习惯到文字气质</span
      >
    </header>

    <div class="comparison-workspace">
      <div class="comparison-inputs">
        <section class="comparison-card comparison-text-card">
          <header class="comparison-card-header">
            <div class="comparison-title-group">
              <span class="comparison-letter">A</span>
              <div>
                <h2><label for="style-reference">参考文本</label></h2>
                <p>作为文风参照的原文</p>
              </div>
            </div>
            <span class="comparison-count"
              >{{ comparison.referenceText.length.toLocaleString() }} /
              30,000</span
            >
          </header>
          <textarea
            id="style-reference"
            v-model="comparison.referenceText"
            :maxlength="STYLE_COMPARISON_TEXT_LIMIT"
            :disabled="comparison.isBusy"
            placeholder="在这里粘贴参考文本…&#10;&#10;建议选择一段能够体现作者语言习惯的完整内容。"
            spellcheck="false"
          />
        </section>

        <section class="comparison-card comparison-text-card">
          <header class="comparison-card-header">
            <div class="comparison-title-group">
              <span class="comparison-letter">B</span>
              <div>
                <h2><label for="style-target">待比对文本</label></h2>
                <p>想要与参考文风进行比较的文本</p>
              </div>
            </div>
            <span class="comparison-count"
              >{{ comparison.comparisonText.length.toLocaleString() }} /
              30,000</span
            >
          </header>
          <textarea
            id="style-target"
            v-model="comparison.comparisonText"
            :maxlength="STYLE_COMPARISON_TEXT_LIMIT"
            :disabled="comparison.isBusy"
            placeholder="在这里粘贴待比对文本…&#10;&#10;两份文本的长度相近、体裁相似时，更容易看出文风差异。"
            spellcheck="false"
          />
        </section>
        <p class="comparison-input-note">
          比较用词、节奏、叙述和情绪表达；评分反映所提供样本的文风接近程度。
        </p>
      </div>

      <aside
        class="comparison-agent comparison-card"
        aria-label="文风比对智能体"
        tabindex="0"
      >
        <header class="comparison-card-header">
          <div class="comparison-title-group">
            <span class="comparison-agent-icon"
              ><AppIcon name="wand" :size="18"
            /></span>
            <div>
              <h2>比对智能体</h2>
              <p>关键发现 · 文风相似度</p>
            </div>
          </div>
          <span class="comparison-agent-tag">文风分析</span>
        </header>
        <div class="comparison-agent-controls">
          <label class="comparison-model"
            ><span>分析模型</span
            ><PopupSelect
              v-model="comparison.modelId"
              :options="modelOptions"
              accessible-label="文风比对模型"
              :disabled="comparison.isBusy || !modelOptions.length"
              :placeholder="
                modelOptions.length ? '选择模型' : '请先在模型配置中添加模型'
              "
          /></label>
          <label class="comparison-model"
            ><span>思考等级</span
            ><PopupSelect
              v-model="comparison.thinkingLevel"
              :options="thinkingOptions"
              accessible-label="文风比对思考等级"
              :disabled="comparison.isBusy || !selectedModel"
          /></label>
          <details class="comparison-method">
            <summary>
              <span><AppIcon name="settings" :size="15" />比对方法</span
              ><span class="comparison-method-hint"
                >可自定义<AppIcon name="chevron" :size="12"
              /></span>
            </summary>
            <div class="comparison-method-editor">
              <label for="style-method">告诉智能体如何比较</label>
              <p>
                补充关注维度、评分权重或判断标准，每次比对都会带入。留空时使用默认方法。
              </p>
              <textarea
                id="style-method"
                v-model="comparison.method"
                :maxlength="STYLE_COMPARISON_METHOD_LIMIT"
                :disabled="comparison.isBusy"
                placeholder="例如：重点比较短句节奏与对白口吻，忽略题材差异…"
              />
              <div>
                <small
                  >{{ comparison.method.length.toLocaleString() }} / 8,000 ·
                  自动记住</small
                ><button
                  class="comparison-text-button"
                  :disabled="comparison.isBusy"
                  type="button"
                  @click="restoreMethod"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </details>
          <button
            v-if="comparison.isBusy"
            class="comparison-run-button is-stop"
            type="button"
            :disabled="comparison.status === 'stopping'"
            @click="comparison.stop()"
          >
            <AppIcon name="stop" :size="15" />{{
              comparison.status === "stopping" ? "正在停止…" : "停止比对"
            }}
          </button>
          <button
            v-else
            class="comparison-run-button"
            type="button"
            :disabled="!canStart"
            @click="start"
          >
            <AppIcon name="wand" :size="16" />{{
              comparison.status === "idle" ? "开始比对" : "重新比对"
            }}
          </button>
        </div>

        <StyleComparisonResult
          :result="comparison.result"
          :preview="comparison.preview"
          :status="comparison.status"
          :activity="comparison.activity"
          :is-stale="comparison.isStale"
          :model-label="comparison.resultModel"
        />
      </aside>
    </div>
  </section>
</template>
