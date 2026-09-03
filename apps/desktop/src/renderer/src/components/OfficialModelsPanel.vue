<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ModelSettings,
  ModelUsageDashboard,
  ModelUsageTotals,
  OfficialModelBalance
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  settings: ModelSettings | null;
  dashboard: ModelUsageDashboard | null;
  balance: OfficialModelBalance | null;
  loading: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  load: [];
  saveToken: [apiKey: string];
  clearToken: [];
  setModelEnabled: [payload: { modelId: string; enabled: boolean }];
}>();

const tokenEditorOpen = ref(false);
const tokenDraft = ref("");
const tokenConfigured = computed(
  () => props.settings?.deepwriteOfficialTokenConfigured === true
);
const officialModels = computed(
  () => props.settings?.deepwriteOfficialModels ?? []
);
const enabledModelIds = computed(
  () =>
    new Set(
      props.settings?.deepwriteOfficialEnabledModelIds ??
        officialModels.value.map((model) => model.id)
    )
);
const enabledModelCount = computed(() => enabledModelIds.value.size);
const totalUsed = computed(() => props.dashboard?.totals.totalTokens ?? 0);
const currentKeyUsagePercentage = computed(() => {
  const granted = props.balance?.currentKeyGrantedYuan;
  const used = props.balance?.currentKeyUsedYuan;
  if (granted === undefined || used === undefined || granted <= 0) return null;
  return Math.min(100, Math.max(0, (used / granted) * 100));
});

const EMPTY_TOTALS: ModelUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  requestCount: 0
};

const modelRows = computed(() =>
  officialModels.value.map((model) => ({
    model,
    totals:
      props.dashboard?.models.find(
        (summary) => summary.model.configId === model.id
      )?.totals ?? EMPTY_TOTALS
  }))
);

watch(tokenConfigured, (configured) => {
  if (!configured) return;
  tokenDraft.value = "";
  tokenEditorOpen.value = false;
});

function openTokenEditor(): void {
  tokenDraft.value = "";
  tokenEditorOpen.value = true;
}

function submitToken(): void {
  const apiKey = tokenDraft.value.trim();
  if (!apiKey) {
    uiMessage.warning("请输入官方令牌。");
    return;
  }
  emit("saveToken", apiKey);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    Math.max(0, Number.isFinite(value) ? value : 0)
  );
}

function formatYuan(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function cacheTokens(totals: ModelUsageTotals): number {
  return totals.cacheReadTokens + totals.cacheWriteTokens;
}

function isModelAvailable(status: 0 | 1 | undefined): boolean {
  return status !== 1;
}

function formatDiscount(discount: number | undefined): string {
  if (discount === undefined) return "--";
  if (discount === 1) return "原价";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(discount * 10)} 折`;
}

function formatPrice(value: number | undefined): string {
  if (value === undefined) return "--";
  return `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)}`;
}
</script>

<template>
  <section
    class="official-models-panel"
    aria-labelledby="official-models-title"
  >
    <header class="official-models-header">
      <div>
        <span class="official-models-kicker">
          <AppIcon name="model" :size="15" /> DeepWrite 旧官方小站托管接入
        </span>
        <h2 id="official-models-title">旧官方小站模型与令牌</h2>
        <p>
          旧官方小站模型来源于国内模型厂商直连，随着软件整体调用量越多，价格会逐渐降低，目前和官方价格一致。
        </p>
      </div>
      <div class="official-models-header-actions">
        <a
          class="official-shop-button"
          href="https://pay.ldxp.cn/shop/UKGFTY58"
          target="_blank"
          rel="noopener noreferrer"
          title="在浏览器中打开官方模型店铺"
        >
          <AppIcon name="globe" :size="15" />
          店铺
        </a>
        <button
          class="official-refresh-button"
          type="button"
          :disabled="loading"
          @click="emit('load')"
        >
          <AppIcon name="history" :size="15" />
          {{ loading ? "刷新中…" : "刷新" }}
        </button>
      </div>
    </header>

    <section
      class="official-token-card"
      :class="{ 'is-configured': tokenConfigured }"
    >
      <div class="official-token-status">
        <span class="official-token-icon"
          ><AppIcon name="model" :size="20"
        /></span>
        <div>
          <strong>{{
            tokenConfigured ? "官方令牌已添加" : "添加你的官方令牌"
          }}</strong>
          <small>
            {{
              tokenConfigured
                ? `已启用 ${enabledModelCount} 个官方模型，令牌明文不会回传到页面。`
                : "添加后，官方模型会自动出现在模型配置列表最上方。"
            }}
          </small>
        </div>
        <span class="official-token-badge">{{
          tokenConfigured ? "已启用" : "未添加"
        }}</span>
      </div>

      <form
        v-if="tokenEditorOpen"
        class="official-token-form"
        @submit.prevent="submitToken"
      >
        <label>
          <span>官方令牌</span>
          <input
            v-model="tokenDraft"
            type="password"
            autocomplete="new-password"
            placeholder="请输入官方令牌"
            :disabled="saving"
          />
        </label>
        <div class="official-token-form-actions">
          <button
            type="button"
            :disabled="saving"
            @click="
              tokenEditorOpen = false;
              tokenDraft = '';
            "
          >
            取消
          </button>
          <button class="is-primary" type="submit" :disabled="saving">
            {{ saving ? "保存中…" : tokenConfigured ? "更新令牌" : "添加令牌" }}
          </button>
        </div>
      </form>

      <div v-else class="official-token-actions">
        <button
          class="is-primary"
          type="button"
          :disabled="saving"
          @click="openTokenEditor"
        >
          <AppIcon name="plus" :size="15" />
          {{ tokenConfigured ? "更换令牌" : "添加令牌" }}
        </button>
        <button
          v-if="tokenConfigured"
          type="button"
          class="is-remove"
          :disabled="saving"
          @click="emit('clearToken')"
        >
          移除令牌
        </button>
      </div>
    </section>

    <section class="official-quota-card" aria-label="官方模型用量与消费">
      <div class="official-quota-heading official-usage-summary">
        <div>
          <span>本机累计使用 Token</span>
          <strong>{{ formatTokens(totalUsed) }}</strong>
        </div>
        <div class="official-quota-remaining">
          <span>当前 Key 费用使用</span>
          <strong>
            {{
              balance?.currentKeyUnlimited
                ? "无限额度"
                : balance?.currentKeyUsedYuan === undefined ||
                    balance?.currentKeyGrantedYuan === undefined
                  ? "--"
                  : `${formatYuan(balance.currentKeyUsedYuan)} / ${formatYuan(balance.currentKeyGrantedYuan)}`
            }}
          </strong>
        </div>
      </div>
      <div
        v-if="currentKeyUsagePercentage !== null"
        class="official-cost-track"
        role="progressbar"
        aria-label="当前 Key 费用使用进度"
        :aria-valuenow="currentKeyUsagePercentage"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: `${currentKeyUsagePercentage}%` }" />
      </div>
      <div class="official-balance-details">
        <span>本机 Token 来自本地账本</span>
        <span v-if="balance?.currentKeyUnlimited">当前 Key 为无限额度</span>
        <span v-else-if="balance?.currentKeyRemainingYuan !== undefined">
          当前 Key 剩余 {{ formatYuan(balance.currentKeyRemainingYuan) }}
        </span>
        <span v-else>当前 Key 费用信息暂不可用</span>
      </div>
    </section>

    <section
      class="official-model-list-card"
      aria-labelledby="official-model-list-title"
    >
      <header>
        <div>
          <span>当前支持</span>
          <h3 id="official-model-list-title">支撑的模型列表</h3>
        </div>
        <span>{{ officialModels.length }} 个模型</span>
      </header>

      <div v-if="loading && !settings" class="official-model-state">
        正在加载官方模型…
      </div>
      <div v-else class="official-model-table-wrap">
        <table class="official-model-table">
          <thead>
            <tr>
              <th scope="col">模型</th>
              <th scope="col">总消耗</th>
              <th scope="col">输入</th>
              <th scope="col">输出</th>
              <th scope="col">缓存</th>
              <th scope="col">折扣</th>
              <th scope="col">价格</th>
              <th scope="col">启用</th>
              <th scope="col">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in modelRows" :key="row.model.id">
              <td>
                <strong>{{ row.model.label }}</strong>
                <small>{{ row.model.modelId }}</small>
              </td>
              <td>{{ formatTokens(row.totals.totalTokens) }}</td>
              <td>{{ formatTokens(row.totals.inputTokens) }}</td>
              <td>{{ formatTokens(row.totals.outputTokens) }}</td>
              <td>
                <strong>{{ formatTokens(cacheTokens(row.totals)) }}</strong>
                <small
                  >读 {{ formatTokens(row.totals.cacheReadTokens) }} · 写
                  {{ formatTokens(row.totals.cacheWriteTokens) }}</small
                >
              </td>
              <td>{{ formatDiscount(row.model.discount) }}</td>
              <td class="official-model-price">
                <span>输入 {{ formatPrice(row.model.input) }}</span>
                <span>输出 {{ formatPrice(row.model.output) }}</span>
                <span>缓存 {{ formatPrice(row.model.cache) }}</span>
                <small>元 / 百万 Token</small>
              </td>
              <td>
                <button
                  class="official-model-toggle"
                  type="button"
                  role="switch"
                  :aria-checked="enabledModelIds.has(row.model.id)"
                  :aria-label="`${row.model.label}启用状态`"
                  :disabled="saving || !isModelAvailable(row.model.status)"
                  @click="
                    emit('setModelEnabled', {
                      modelId: row.model.id,
                      enabled: !enabledModelIds.has(row.model.id)
                    })
                  "
                >
                  <span />
                </button>
              </td>
              <td>
                <span
                  class="official-model-status"
                  :class="{
                    'is-enabled':
                      tokenConfigured && isModelAvailable(row.model.status),
                    'is-unavailable': !isModelAvailable(row.model.status)
                  }"
                >
                  {{
                    !isModelAvailable(row.model.status)
                      ? "不可用"
                      : !tokenConfigured
                        ? "待添加令牌"
                        : "可用"
                  }}
                </span>
              </td>
            </tr>
            <tr v-if="!modelRows.length">
              <td colspan="9" class="official-model-state">暂无官方模型。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.official-models-panel {
  display: grid;
  gap: 18px;
  width: 100%;
  padding-bottom: 36px;
  color: var(--text-primary);
}
.official-models-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}
.official-models-header h2 {
  margin: 6px 0 8px;
  font-size: 1.5rem;
}
.official-models-header p {
  max-width: 720px;
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
}
.official-models-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
  font-size: 0.857143rem;
  font-weight: 650;
}
.official-models-header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.official-shop-button,
.official-refresh-button,
.official-token-actions button,
.official-token-form-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.official-shop-button {
  border-color: color-mix(in srgb, var(--text-primary) 88%, transparent);
  background: var(--text-primary);
  color: var(--surface-main);
  text-decoration: none;
}
.official-shop-button:hover {
  opacity: 0.9;
}
.official-shop-button:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
button:disabled {
  cursor: wait;
  opacity: 0.58;
}
.official-token-card,
.official-quota-card,
.official-model-list-card {
  border: 1px solid var(--theme-line-soft);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 1px 3px
    color-mix(in srgb, var(--theme-foreground) 4%, transparent);
}
.official-token-card {
  padding: 18px;
}
.official-token-card.is-configured {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--theme-line-soft));
}
.official-token-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
}
.official-token-status > div {
  display: grid;
  gap: 4px;
}
.official-token-status small {
  color: var(--text-secondary);
  line-height: 1.5;
}
.official-token-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}
.official-token-badge,
.official-model-status {
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  white-space: nowrap;
}
.official-token-card.is-configured .official-token-badge,
.official-model-status.is-enabled {
  background: var(--accent-soft);
  color: var(--accent);
}
.official-model-status.is-unavailable {
  background: color-mix(in srgb, var(--danger) 12%, var(--surface-muted));
  color: var(--danger);
}
.official-token-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 15px;
}
.official-token-actions .is-primary,
.official-token-form-actions .is-primary {
  border-color: color-mix(in srgb, var(--text-primary) 88%, transparent);
  background: var(--text-primary);
  color: var(--surface-main);
}
.official-token-actions .is-remove {
  color: var(--text-secondary);
}
.official-token-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--theme-line-soft);
}
.official-token-form label {
  display: grid;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  font-weight: 620;
}
.official-token-form input {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}
.official-token-form input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.official-token-form-actions {
  display: flex;
  gap: 8px;
}
.official-quota-card {
  padding: 18px 20px;
}
.official-quota-heading {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}
.official-quota-heading > div {
  display: grid;
  gap: 5px;
}
.official-quota-heading span,
.official-model-list-card > header span {
  color: var(--text-tertiary);
  font-size: 0.821429rem;
  font-weight: 600;
}
.official-quota-heading strong {
  font-size: 1.285714rem;
}
.official-quota-remaining {
  text-align: right;
}
.official-usage-summary {
  align-items: end;
}
.official-cost-track {
  height: 7px;
  margin-top: 15px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-muted);
}
.official-cost-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s ease;
}
.official-balance-details {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 18px;
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid var(--theme-line-soft);
  color: var(--text-secondary);
  font-size: 0.821429rem;
}
.official-model-list-card {
  overflow: hidden;
}
.official-model-list-card > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 17px 20px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.official-model-list-card h3 {
  margin: 3px 0 0;
  font-size: 1.071429rem;
}
.official-model-table-wrap {
  overflow-x: auto;
}
.official-model-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}
.official-model-table th,
.official-model-table td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--theme-line-soft);
  text-align: left;
  vertical-align: middle;
}
.official-model-table tr:last-child td {
  border-bottom: 0;
}
.official-model-table th {
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
}
.official-model-table td {
  color: var(--text-secondary);
  font-size: 0.857143rem;
  font-variant-numeric: tabular-nums;
}
.official-model-table td:first-child {
  min-width: 240px;
}
.official-model-table td:first-child,
.official-model-table td:nth-child(5) {
  display: table-cell;
}
.official-model-table td strong,
.official-model-table td small {
  display: block;
}
.official-model-table td:first-child strong {
  color: var(--text-primary);
  font-size: 0.928571rem;
}
.official-model-table td small {
  margin-top: 4px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
.official-model-price span {
  display: block;
  white-space: nowrap;
}
.official-model-toggle {
  position: relative;
  width: 38px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--theme-line);
  border-radius: 999px;
  background: var(--surface-muted);
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease;
}
.official-model-toggle span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition:
    transform 0.16s ease,
    background 0.16s ease;
}
.official-model-toggle[aria-checked="true"] {
  border-color: var(--accent);
  background: var(--accent);
}
.official-model-toggle[aria-checked="true"] span {
  background: var(--surface-main);
  transform: translateX(16px);
}
.official-model-toggle:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.official-model-state {
  padding: 28px;
  color: var(--text-tertiary);
  text-align: center;
}

@media (max-width: 900px) {
  .official-models-header {
    flex-direction: column;
  }
  .official-models-header-actions {
    align-self: flex-end;
  }
  .official-token-form {
    grid-template-columns: 1fr;
  }
  .official-token-form-actions {
    justify-content: flex-end;
  }
}
</style>
