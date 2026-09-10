<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  isDeepWriteSiteOfficialModel,
  type ModelUsageDashboard,
  type ModelUsageModule,
  type ModelUsageQueryInput
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import { MODULE_META } from "./modelUsageModuleMeta";

type TimeRange = "24h" | 7 | 30 | "all";

interface RangeOption {
  id: TimeRange;
  label: string;
}

interface TrendChartPoint {
  x: number;
  y: number;
  bucketStart: string;
  value: number;
}

const props = defineProps<{
  dashboard: ModelUsageDashboard | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  query: [input: ModelUsageQueryInput];
}>();

const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: "24h", label: "近 24 小时" },
  { id: 7, label: "近 7 天" },
  { id: 30, label: "近 30 天" },
  { id: "all", label: "全部" }
];

const selectedRange = ref<TimeRange>("24h");
const CHART_WIDTH = 640;
const CHART_HEIGHT = 136;
const CHART_PADDING_X = 12;
const CHART_PADDING_TOP = 12;
const CHART_PADDING_BOTTOM = 18;

const hasDashboard = computed(() => props.dashboard !== null);
const isEmpty = computed(
  () => Boolean(props.dashboard) && props.dashboard!.totals.requestCount === 0
);
const hasModels = computed(() => Boolean(props.dashboard?.models.length));
const showDashboard = computed(
  () => hasDashboard.value && (!isEmpty.value || hasModels.value)
);
const rangeLabel = computed(
  () =>
    RANGE_OPTIONS.find((option) => option.id === selectedRange.value)?.label ??
    "近 24 小时"
);

const moduleRows = computed(() =>
  (props.dashboard?.modules ?? [])
    .filter((item) => item.totals.requestCount > 0)
    .slice()
    .sort((left, right) => right.totals.totalTokens - left.totals.totalTokens)
);
const maxModuleTokens = computed(() =>
  Math.max(1, ...moduleRows.value.map((item) => item.totals.totalTokens))
);

const trendChartPoints = computed<TrendChartPoint[]>(() => {
  const trend = props.dashboard?.trend ?? [];
  if (!trend.length) return [];

  const maxValue = Math.max(1, ...trend.map((item) => item.totals.totalTokens));
  const usableWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const usableHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  return trend.map((item, index) => {
    const x =
      trend.length === 1
        ? CHART_WIDTH / 2
        : CHART_PADDING_X + (usableWidth * index) / (trend.length - 1);
    const y =
      CHART_PADDING_TOP +
      usableHeight * (1 - item.totals.totalTokens / maxValue);
    return {
      x,
      y,
      bucketStart: item.bucketStart,
      value: item.totals.totalTokens
    };
  });
});

const trendLinePath = computed(() => {
  const points = trendChartPoints.value;
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
});

const trendAreaPath = computed(() => {
  const points = trendChartPoints.value;
  if (!points.length) return "";
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  const baseline = CHART_HEIGHT - CHART_PADDING_BOTTOM;
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
});

const trendStartLabel = computed(
  () => trendChartPoints.value[0]?.bucketStart ?? ""
);
const trendEndLabel = computed(
  () =>
    trendChartPoints.value[trendChartPoints.value.length - 1]?.bucketStart ?? ""
);
const trendAccessibleLabel = computed(() => {
  if (!trendChartPoints.value.length) return `${rangeLabel.value}暂无趋势数据`;
  return `${rangeLabel.value}模型总 Token 趋势，共 ${formatTokens(
    props.dashboard?.totals.totalTokens ?? 0
  )}`;
});

function createQuery(range: TimeRange): ModelUsageQueryInput {
  if (range === "all") return {};
  const endAt = new Date();
  const startAt = new Date(endAt);
  if (range === "24h") {
    startAt.setTime(endAt.getTime() - 24 * 60 * 60 * 1_000);
  } else {
    startAt.setHours(0, 0, 0, 0);
    startAt.setDate(startAt.getDate() - (range - 1));
  }
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function selectRange(range: TimeRange): void {
  if (selectedRange.value === range) return;
  selectedRange.value = range;
  emit("query", createQuery(range));
}

function refresh(): void {
  emit("query", createQuery(selectedRange.value));
}

function formatTokens(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    safeValue
  );
}

function formatTrendBucket(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  if (props.dashboard?.trendGranularity === "hour") {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit"
    }).format(timestamp);
  }
  if (props.dashboard?.trendGranularity === "month") {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "numeric"
    }).format(timestamp);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric"
  }).format(timestamp);
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "未使用";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function moduleLabel(module: ModelUsageModule): string {
  return MODULE_META[module].label;
}

function moduleDetail(module: ModelUsageModule): string {
  return MODULE_META[module].detail;
}

function modulePercentage(value: number): string {
  return `${Math.max(4, Math.round((value / maxModuleTokens.value) * 100))}%`;
}

function modelStatusLabel(status: "current" | "historical" | "faux"): string {
  if (status === "current") return "当前配置";
  if (status === "historical") return "历史模型";
  return "本地模拟";
}

function modelProviderLabel(
  model: ModelUsageDashboard["models"][number]["model"]
): string {
  if (model.managedBy === "deepwrite-official") return "旧官方小站";
  if (isDeepWriteSiteOfficialModel(model)) return "新官方小站";
  if (model.managedBy === "deepwrite-free") return "DeepWrite 免费";
  return model.provider;
}

function modelBadgeLabel(
  model: ModelUsageDashboard["models"][number]["model"]
): string {
  const source = model.managedBy ? "D" : model.provider.trim().slice(0, 1);
  return source.toLocaleUpperCase() || "M";
}

function actorLabel(
  actor: ModelUsageDashboard["recentCalls"][number]["actor"]
): string {
  if (actor === "subagent") return "子智能体";
  if (actor === "connection-test") return "连接测试";
  return "主智能体";
}

function callStatusLabel(
  status: ModelUsageDashboard["recentCalls"][number]["status"]
): string {
  if (status === "error") return "错误";
  if (status === "aborted") return "已中止";
  return "完成";
}

onMounted(() => {
  emit("query", createQuery(selectedRange.value));
});
</script>

<template>
  <section class="model-usage-panel" aria-labelledby="model-usage-title">
    <header class="usage-header">
      <div class="usage-heading">
        <span class="usage-kicker"
          ><AppIcon name="ledger" :size="15" /> 本地用量账本</span
        >
        <h2 id="model-usage-title">模型用量</h2>
        <p>
          查看此设备上各模型和模块的 Token 使用情况。逐次明细仅保留最近 100
          条，更早调用只保留聚合统计。
        </p>
      </div>
      <button
        type="button"
        class="usage-refresh"
        :disabled="loading"
        @click="refresh"
      >
        <AppIcon name="history" :size="15" />
        {{ loading ? "正在刷新…" : "刷新" }}
      </button>
    </header>

    <div class="usage-toolbar" role="toolbar" aria-label="用量时间范围">
      <span>时间范围</span>
      <div class="usage-range-options" role="group" aria-label="选择时间范围">
        <button
          v-for="option in RANGE_OPTIONS"
          :key="option.id"
          type="button"
          class="usage-range-option"
          :class="{ 'is-active': selectedRange === option.id }"
          :aria-pressed="selectedRange === option.id"
          @click="selectRange(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
      <span v-if="dashboard" class="usage-updated-at">
        更新于 {{ formatDateTime(dashboard.generatedAt) }}
      </span>
    </div>

    <div
      v-if="loading && !dashboard"
      class="usage-state is-loading"
      aria-live="polite"
    >
      <span class="usage-spinner" aria-hidden="true" />
      <strong>正在读取本地用量…</strong>
      <p>正在汇总模型与模块的使用记录。</p>
    </div>

    <div v-else-if="!dashboard" class="usage-state">
      <AppIcon name="ledger" :size="24" />
      <strong>尚未加载用量数据</strong>
      <p>请刷新后重试。</p>
      <button type="button" class="usage-refresh" @click="refresh">
        刷新用量
      </button>
    </div>

    <div v-else-if="isEmpty && !hasModels" class="usage-state">
      <AppIcon name="sparkles" :size="24" />
      <strong>还没有模型用量</strong>
      <p>之后的模型调用会自动统计并仅保存在此设备中。</p>
    </div>

    <div v-else-if="showDashboard && dashboard" class="usage-dashboard">
      <section class="usage-summary-grid" aria-label="用量汇总">
        <article class="usage-summary-card is-total">
          <span>总 Token</span>
          <strong>{{ formatTokens(dashboard.totals.totalTokens) }}</strong>
          <small
            >{{ formatTokens(dashboard.totals.requestCount) }} 次模型请求</small
          >
        </article>
        <article class="usage-summary-card">
          <span>输入 Token</span>
          <strong>{{ formatTokens(dashboard.totals.inputTokens) }}</strong>
          <small>发送给模型的上下文</small>
        </article>
        <article class="usage-summary-card">
          <span>输出 Token</span>
          <strong>{{ formatTokens(dashboard.totals.outputTokens) }}</strong>
          <small>模型生成的内容</small>
        </article>
        <article class="usage-summary-card">
          <span>缓存 Token</span>
          <strong>{{
            formatTokens(
              dashboard.totals.cacheReadTokens +
                dashboard.totals.cacheWriteTokens
            )
          }}</strong>
          <small
            >读取 {{ formatTokens(dashboard.totals.cacheReadTokens) }} · 写入
            {{ formatTokens(dashboard.totals.cacheWriteTokens) }}</small
          >
        </article>
      </section>

      <section
        class="usage-card usage-trend-card"
        aria-labelledby="usage-trend-title"
      >
        <header class="usage-card-header">
          <div>
            <span>趋势</span>
            <h3 id="usage-trend-title">{{ rangeLabel }}总 Token</h3>
          </div>
          <strong>{{ formatTokens(dashboard.totals.totalTokens) }}</strong>
        </header>
        <div v-if="trendChartPoints.length" class="usage-trend-chart">
          <svg
            :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`"
            preserveAspectRatio="none"
            role="img"
            :aria-label="trendAccessibleLabel"
          >
            <title>{{ trendAccessibleLabel }}</title>
            <line
              v-for="position in [0.2, 0.5, 0.8]"
              :key="position"
              class="usage-chart-gridline"
              :x1="CHART_PADDING_X"
              :x2="CHART_WIDTH - CHART_PADDING_X"
              :y1="
                CHART_PADDING_TOP +
                (CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) *
                  position
              "
              :y2="
                CHART_PADDING_TOP +
                (CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) *
                  position
              "
            />
            <path class="usage-chart-area" :d="trendAreaPath" />
            <path class="usage-chart-line" :d="trendLinePath" />
            <circle
              v-for="point in trendChartPoints"
              :key="point.bucketStart"
              class="usage-chart-point"
              :cx="point.x"
              :cy="point.y"
              r="2.8"
            >
              <title>
                {{
                  `${formatTrendBucket(point.bucketStart)}：${formatTokens(point.value)} Token`
                }}
              </title>
            </circle>
          </svg>
          <div class="usage-chart-dates" aria-hidden="true">
            <span>{{ formatTrendBucket(trendStartLabel) }}</span>
            <span>{{ formatTrendBucket(trendEndLabel) }}</span>
          </div>
        </div>
        <div v-else class="usage-chart-empty">
          这个时间范围内没有可展示的趋势数据。
        </div>
      </section>

      <div class="usage-detail-grid">
        <section
          class="usage-card usage-module-card"
          aria-labelledby="usage-module-title"
        >
          <header class="usage-card-header">
            <div>
              <span>模块</span>
              <h3 id="usage-module-title">模块分布</h3>
            </div>
            <AppIcon name="sparkles" :size="17" />
          </header>
          <div v-if="moduleRows.length" class="usage-module-list">
            <div
              v-for="item in moduleRows"
              :key="item.module"
              class="usage-module-row"
            >
              <div class="usage-module-name">
                <strong>{{ moduleLabel(item.module) }}</strong>
                <small>{{ moduleDetail(item.module) }}</small>
              </div>
              <div class="usage-module-value">
                <strong>{{ formatTokens(item.totals.totalTokens) }}</strong>
                <small
                  >{{ formatTokens(item.totals.requestCount) }} 次请求</small
                >
              </div>
              <div class="usage-module-track" aria-hidden="true">
                <span
                  :style="{ width: modulePercentage(item.totals.totalTokens) }"
                />
              </div>
            </div>
          </div>
          <p v-else class="usage-inline-empty">这个时间范围内尚无模块用量。</p>
        </section>

        <section
          class="usage-card usage-model-card"
          aria-labelledby="usage-model-title"
        >
          <header class="usage-card-header">
            <div>
              <span>模型</span>
              <h3 id="usage-model-title">模型状态</h3>
            </div>
            <AppIcon name="model" :size="17" />
          </header>
          <div class="usage-model-table-wrap">
            <table class="usage-model-table">
              <thead>
                <tr>
                  <th scope="col">模型</th>
                  <th scope="col">状态</th>
                  <th scope="col">总 Token</th>
                  <th scope="col">调用</th>
                  <th scope="col">最近使用</th>
                </tr>
              </thead>
              <tbody v-if="dashboard.models.length">
                <tr
                  v-for="item in dashboard.models"
                  :key="`${item.model.configId}:${item.model.revisionId}`"
                >
                  <td>
                    <div class="usage-model-identity">
                      <span class="usage-model-badge" aria-hidden="true">{{
                        modelBadgeLabel(item.model)
                      }}</span>
                      <span>
                        <strong>{{ item.model.label }}</strong>
                        <small
                          >{{ modelProviderLabel(item.model) }} ·
                          {{ item.model.modelId }}</small
                        >
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      class="usage-model-status"
                      :class="`is-${item.status}`"
                    >
                      <i aria-hidden="true" />{{
                        modelStatusLabel(item.status)
                      }}
                    </span>
                  </td>
                  <td>
                    <strong>{{ formatTokens(item.totals.totalTokens) }}</strong>
                    <small
                      >入 {{ formatTokens(item.totals.inputTokens) }} · 出
                      {{ formatTokens(item.totals.outputTokens) }}</small
                    >
                  </td>
                  <td>{{ formatTokens(item.totals.requestCount) }}</td>
                  <td>
                    <time v-if="item.lastUsedAt" :datetime="item.lastUsedAt">
                      {{ formatDateTime(item.lastUsedAt) }}
                    </time>
                    <span v-else class="usage-model-unused">未使用</span>
                  </td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr>
                  <td colspan="5" class="usage-table-empty">
                    这个时间范围内尚无模型记录。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section
        class="usage-card usage-recent-card"
        aria-labelledby="usage-recent-title"
      >
        <header class="usage-card-header">
          <div>
            <span>调用明细</span>
            <h3 id="usage-recent-title">最近实际调用</h3>
          </div>
          <small
            >显示 {{ dashboard.recentCalls.length }} 条 · 本地最多保留 100
            条</small
          >
        </header>
        <div class="usage-model-table-wrap">
          <table class="usage-model-table usage-recent-table">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">模型</th>
                <th scope="col">模块</th>
                <th scope="col">调用方</th>
                <th scope="col">状态</th>
                <th scope="col">Token</th>
              </tr>
            </thead>
            <tbody v-if="dashboard.recentCalls.length">
              <tr
                v-for="(call, index) in dashboard.recentCalls"
                :key="`${call.occurredAt}:${call.model.configId}:${index}`"
              >
                <td>
                  <time :datetime="call.occurredAt">{{
                    formatDateTime(call.occurredAt)
                  }}</time>
                </td>
                <td>
                  <strong>{{ call.model.label }}</strong>
                  <small
                    >{{ modelProviderLabel(call.model) }} ·
                    {{ call.model.modelId }}</small
                  >
                </td>
                <td>{{ moduleLabel(call.module) }}</td>
                <td>{{ actorLabel(call.actor) }}</td>
                <td>
                  <span class="usage-call-status" :class="`is-${call.status}`">
                    {{ callStatusLabel(call.status) }}
                  </span>
                </td>
                <td>
                  <strong>{{ formatTokens(call.usage.totalTokens) }}</strong>
                  <small>
                    入 {{ formatTokens(call.usage.inputTokens) }} · 出
                    {{ formatTokens(call.usage.outputTokens) }} · 缓存
                    {{
                      formatTokens(
                        call.usage.cacheReadTokens + call.usage.cacheWriteTokens
                      )
                    }}
                  </small>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="6" class="usage-table-empty">
                  尚无实际模型调用明细。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.model-usage-panel {
  width: min(100%, 1060px);
  color: var(--text-primary);
}

.usage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.usage-heading {
  min-width: 0;
}
.usage-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.usage-heading h2 {
  margin: 4px 0 5px;
  color: var(--text-primary);
  font-size: 1.57143rem;
  font-weight: 650;
}
.usage-heading p {
  max-width: 680px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}

.usage-refresh,
.usage-text-button,
.usage-range-option {
  font: inherit;
  cursor: pointer;
}
.usage-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--text-primary);
  border-radius: 8px;
  background: var(--text-primary);
  color: var(--surface-main);
  font-size: 0.857143rem;
  font-weight: 620;
  white-space: nowrap;
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.usage-refresh:hover:not(:disabled) {
  opacity: 0.88;
  transform: translateY(-1px);
}
.usage-refresh:focus-visible,
.usage-range-option:focus-visible,
.usage-text-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.usage-refresh:disabled,
.usage-text-button:disabled {
  cursor: default;
  opacity: 0.58;
}

.usage-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 44px;
  margin-bottom: 18px;
  padding: 7px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 11px;
  background: var(--surface-raised);
}
.usage-toolbar > span:first-child {
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 590;
}
.usage-range-options {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.usage-range-option {
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 570;
}
.usage-range-option:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.usage-range-option.is-active {
  border-color: var(--theme-line);
  background: var(--surface-selected);
  color: var(--text-primary);
}
.usage-updated-at {
  margin-left: auto;
  padding: 0 4px;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
}

.usage-state {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  min-height: 250px;
  padding: 30px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 14px;
  background: var(--surface-raised);
  color: var(--text-tertiary);
  text-align: center;
}
.usage-state strong {
  margin-top: 11px;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 630;
}
.usage-state p {
  max-width: 360px;
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.5;
}
.usage-state .usage-refresh {
  margin-top: 14px;
}
.usage-state.is-loading {
  color: var(--accent);
}
.usage-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--theme-line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: usage-spin 0.8s linear infinite;
}
@keyframes usage-spin {
  to {
    transform: rotate(360deg);
  }
}

.usage-dashboard {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.usage-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.usage-summary-card {
  display: flex;
  flex-direction: column;
  min-height: 123px;
  padding: 15px 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.usage-summary-card > span {
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 580;
}
.usage-summary-card > strong {
  margin-top: 10px;
  color: var(--text-primary);
  font-size: clamp(1.25rem, 2vw, 1.714286rem);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.usage-summary-card > small {
  margin-top: auto;
  padding-top: 8px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
}
.usage-summary-card.is-total {
  border-color: var(--accent);
  background: var(--surface-selected);
}

.usage-card {
  min-width: 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 13px;
  background: var(--surface-raised);
}
.usage-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 16px 12px;
}
.usage-card-header > div > span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.usage-card-header h3 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 630;
}
.usage-card-header > strong {
  color: var(--text-primary);
  font-size: 0.964286rem;
  font-variant-numeric: tabular-nums;
}
.usage-card-header > small {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: right;
}
.usage-card-header > :deep(svg) {
  color: var(--text-tertiary);
}

.usage-trend-chart {
  padding: 0 12px 11px;
}
.usage-trend-chart svg {
  display: block;
  width: 100%;
  height: 156px;
  overflow: visible;
}
.usage-chart-gridline {
  stroke: var(--theme-line-soft);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.usage-chart-area {
  fill: var(--accent-soft);
  opacity: 0.72;
}
.usage-chart-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.usage-chart-point {
  fill: var(--surface-raised);
  stroke: var(--accent);
  stroke-width: 1.6;
  vector-effect: non-scaling-stroke;
}
.usage-chart-dates {
  display: flex;
  justify-content: space-between;
  padding: 0 4px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
.usage-chart-empty {
  display: grid;
  min-height: 156px;
  place-items: center;
  padding: 0 16px 16px;
  color: var(--text-tertiary);
  font-size: 0.857143rem;
  text-align: center;
}

.usage-detail-grid {
  display: grid;
  grid-template-columns: minmax(250px, 0.85fr) minmax(0, 1.65fr);
  gap: 18px;
  align-items: start;
}
.usage-module-list {
  display: flex;
  flex-direction: column;
  padding: 0 16px 12px;
}
.usage-module-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 12px;
  padding: 11px 0;
  border-top: 1px solid var(--theme-line-soft);
}
.usage-module-name,
.usage-module-value {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.usage-module-name strong,
.usage-module-value strong {
  color: var(--text-primary);
  font-size: 0.857143rem;
  font-weight: 610;
}
.usage-module-name small,
.usage-module-value small {
  overflow: hidden;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-module-value {
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.usage-module-track {
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-muted);
}
.usage-module-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}
.usage-inline-empty {
  margin: 0;
  padding: 14px 16px 20px;
  color: var(--text-tertiary);
  font-size: 0.857143rem;
}

.usage-model-table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--theme-line-soft);
}
.usage-model-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 0.821429rem;
}
.usage-model-table th {
  padding: 9px 12px;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  font-weight: 620;
  letter-spacing: 0.025em;
  text-align: left;
  white-space: nowrap;
}
.usage-model-table td {
  padding: 11px 12px;
  border-top: 1px solid var(--theme-line-soft);
  color: var(--text-secondary);
  vertical-align: middle;
}
.usage-model-table tbody tr:first-child td {
  border-top: 0;
}
.usage-model-table td > strong {
  display: block;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 610;
}
.usage-model-table td > small {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  white-space: nowrap;
}
.usage-model-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 190px;
}
.usage-model-identity > span:last-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.usage-model-identity strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.857143rem;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-model-identity small {
  overflow: hidden;
  max-width: 210px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-model-badge {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 700;
}
.usage-model-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 580;
  white-space: nowrap;
}
.usage-model-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.usage-model-status.is-current i {
  background: var(--accent);
}
.usage-model-status.is-historical i {
  background: var(--text-tertiary);
}
.usage-model-status.is-faux i {
  background: var(--text-primary);
}
.usage-model-table time {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.usage-model-unused {
  color: var(--text-tertiary);
  white-space: nowrap;
}
.usage-table-empty {
  padding: 24px !important;
  color: var(--text-tertiary) !important;
  text-align: center;
}
.usage-recent-table {
  min-width: 820px;
}
.usage-recent-table td:first-child {
  white-space: nowrap;
}
.usage-call-status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 590;
  white-space: nowrap;
}
.usage-call-status.is-completed {
  color: var(--text-primary);
}
.usage-call-status.is-error,
.usage-call-status.is-aborted {
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .usage-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .usage-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .usage-header {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }
  .usage-header .usage-refresh {
    align-self: flex-start;
  }
  .usage-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .usage-updated-at {
    margin-left: 0;
  }
  .usage-summary-grid {
    grid-template-columns: 1fr;
  }
  .usage-summary-card {
    min-height: 102px;
  }
}
</style>
