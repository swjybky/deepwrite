<script setup lang="ts">
import { computed } from "vue";
import type {
  StyleComparisonResult,
  StyleComparisonDimension
} from "@deepwrite/contracts";
import AppIcon from "../../components/AppIcon.vue";
import { uiMessage } from "../../ui-feedback";
import { similarityLabel } from "./result";

const props = defineProps<{
  result: StyleComparisonResult | null;
  preview: { summary: string; dimensions: StyleComparisonDimension[] };
  status: string;
  activity: string;
  isStale: boolean;
  modelLabel: string;
}>();
const busy = computed(() =>
  ["starting", "running", "stopping"].includes(props.status)
);
const dimensions = computed(
  () => props.result?.dimensions ?? props.preview.dimensions
);
const summary = computed(() => props.result?.summary ?? props.preview.summary);
async function copyResult(): Promise<void> {
  if (!props.result) return;
  const result = props.result;
  const content = [
    "文风比对",
    `文风相似度：${result.score}/100 · ${similarityLabel(result.score)}`,
    result.summary,
    "",
    ...result.dimensions.map(
      (item) => `${item.name} ${item.score}/100：${item.reason}`
    ),
    "",
    "关键共性",
    ...result.similarities.map((item) => `- ${item}`),
    "",
    "主要差异",
    ...result.differences.map((item) => `- ${item}`)
  ].join("\n");
  try {
    await navigator.clipboard.writeText(content);
    uiMessage.success("已复制比对结果。");
  } catch {
    uiMessage.error("复制失败，请重试。");
  }
}
</script>

<template>
  <div class="comparison-results" :aria-busy="busy">
    <div v-if="status === 'idle'" class="comparison-empty">
      <div class="comparison-empty-mark">
        <AppIcon name="file" :size="24" /><span>≈</span
        ><AppIcon name="file" :size="24" />
      </div>
      <h3>两段文字，一次细读</h3>
      <p>
        添加两份文本后开始比对。<br />这里会呈现关键共性、主要差异和最终评分。
      </p>
      <div class="comparison-dimension-tags">
        <span>措辞</span><span>节奏</span><span>叙述</span><span>修辞</span
        ><span>语气</span>
      </div>
    </div>
    <template v-else>
      <div class="comparison-progress" role="status">
        <span
          :class="{ 'is-running': busy }"
          class="comparison-status-dot"
        /><span>{{
          isStale && !busy ? "输入已更新，请重新比对" : activity
        }}</span
        ><small v-if="result && !isStale">{{ modelLabel }}</small>
      </div>
      <section
        class="comparison-score"
        :class="{ 'is-pending': !result }"
        aria-label="文风相似度评分"
      >
        <div>
          <p>{{ isStale ? "上次文风相似度" : "文风相似度" }}</p>
          <div class="comparison-score-number">
            <strong>{{ result ? result.score : "—" }}</strong
            ><span>/ 100</span>
          </div>
        </div>
        <span class="comparison-score-label">{{
          result
            ? similarityLabel(result.score)
            : busy
              ? "正在评估"
              : "未完成评分"
        }}</span>
      </section>
      <p v-if="summary" class="comparison-summary">{{ summary }}</p>
      <p v-else class="comparison-waiting">
        {{
          busy
            ? "智能体正在细读文本，关键发现会陆续显示。"
            : "本次未生成完整结果，可重新比对。"
        }}
      </p>
      <section
        v-if="dimensions.length"
        class="comparison-dimensions"
        aria-label="各维度关键发现"
      >
        <h3>关键发现</h3>
        <article
          v-for="(dimension, index) in dimensions"
          :key="index"
          class="comparison-dimension"
        >
          <header>
            <h4>{{ dimension.name }}</h4>
            <span>{{ dimension.score }}<small> / 100</small></span>
          </header>
          <div class="comparison-meter" aria-hidden="true">
            <span :style="{ width: `${dimension.score}%` }" />
          </div>
          <p>{{ dimension.reason }}</p>
        </article>
      </section>
      <template v-if="result">
        <section class="comparison-findings">
          <h3>关键共性</h3>
          <ul>
            <li v-for="item in result.similarities" :key="item">{{ item }}</li>
          </ul>
        </section>
        <section class="comparison-findings">
          <h3>主要差异</h3>
          <ul>
            <li v-for="item in result.differences" :key="item">{{ item }}</li>
          </ul>
        </section>
        <footer class="comparison-result-footer">
          <small>基于本次文本的 AI 评估</small
          ><button
            class="comparison-text-button"
            type="button"
            @click="copyResult"
          >
            <AppIcon name="copy" :size="14" />复制结果
          </button>
        </footer>
      </template>
    </template>
  </div>
</template>
