<script setup lang="ts">
import { computed, ref } from "vue";
import {
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type SiteOfficialQuota
} from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import { toModelInput } from "./modelSettingsDraft";

const props = defineProps<{
  settings: ModelSettings | null;
  saving: boolean;
  refreshing: boolean;
  quota: SiteOfficialQuota | null;
  testingModelId: string | null;
}>();

const emit = defineEmits<{
  saveToken: [apiKey: string];
  clearToken: [];
  refresh: [];
  setModelEnabled: [payload: { modelId: string; enabled: boolean }];
  test: [model: ModelConfigInput];
}>();

const tokenEditorOpen = ref(false);
const tokenDraft = ref("");
const configuredModels = computed(
  () => props.settings?.models.filter(isDeepWriteSiteOfficialModel) ?? []
);
const tokenConfigured = computed(() =>
  configuredModels.value.some((model) => model.hasApiKey)
);
const enabledModelCount = computed(
  () => configuredModels.value.filter((model) => model.enabled !== false).length
);
const quotaUsedPercentage = computed(() => {
  if (!props.quota || props.quota.unlimited || !props.quota.total) return 0;
  return Math.min(
    100,
    Math.max(0, (props.quota.used / props.quota.total) * 100)
  );
});

function openTokenEditor(): void {
  tokenDraft.value = "";
  tokenEditorOpen.value = true;
}

function closeTokenEditor(): void {
  tokenDraft.value = "";
  tokenEditorOpen.value = false;
}

function submitToken(): void {
  const apiKey = tokenDraft.value.trim();
  if (!apiKey) {
    uiMessage.warning("请输入新官方小站模型密钥。");
    return;
  }
  emit("saveToken", apiKey);
  closeTokenEditor();
}

function testModel(model: ModelConfig): void {
  emit("test", toModelInput(model));
}

function toggleModel(model: ModelConfig): void {
  emit("setModelEnabled", {
    modelId: model.id,
    enabled: model.enabled === false
  });
}

function formatPrice(value: number | undefined): string {
  return value === undefined ? "--" : `¥${value}`;
}

function formatQuota(value: number | null | undefined): string {
  if (value === undefined || value === null) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function quotaSummary(): string {
  if (!props.quota) {
    return tokenConfigured.value
      ? "额度信息暂不可用，可点击右上角刷新页面重试。"
      : "添加模型密钥后即可查看额度进度。";
  }
  if (props.quota.unlimited) return "当前密钥为无限额度。";
  return `额度已使用 ${quotaUsedPercentage.value.toFixed(1)}%`;
}
</script>

<template>
  <section class="site-models-panel" aria-labelledby="site-models-title">
    <header class="site-models-header">
      <div>
        <span class="site-models-kicker">
          <AppIcon name="model" :size="15" /> DeepWrite 新官方小站
        </span>
        <h2 id="site-models-title">新官方小站模型与密钥</h2>
        <p>
          使用新官方小站签发的模型密钥连接 DeepWriteApi
          网关。密钥由你自行配置，保存后模型才会出现在模型配置与选择器中。
        </p>
      </div>
      <div class="site-models-header-actions">
        <a
          class="site-shop-button"
          href="https://pay.ldxp.cn/shop/UKGFTY58"
          target="_blank"
          rel="noopener noreferrer"
          title="在浏览器中打开小站店铺"
        >
          <AppIcon name="globe" :size="15" />
          小站店铺
        </a>
        <button
          class="site-models-refresh"
          type="button"
          :disabled="refreshing || saving || !tokenConfigured"
          @click="emit('refresh')"
        >
          <AppIcon name="history" :size="15" />
          {{ refreshing ? "刷新中…" : "刷新页面" }}
        </button>
      </div>
    </header>

    <section
      class="site-token-card"
      :class="{ 'is-configured': tokenConfigured }"
    >
      <div class="site-token-status">
        <span class="site-token-icon">
          <AppIcon name="model" :size="20" />
        </span>
        <div>
          <strong>{{
            tokenConfigured ? "新小站密钥已添加" : "添加你的新小站密钥"
          }}</strong>
          <small>
            {{
              tokenConfigured
                ? `已启用 ${enabledModelCount} 个模型，密钥明文不会回传到页面。`
                : "保存密钥后，相关模型才会加入模型列表。"
            }}
          </small>
        </div>
        <span class="site-token-badge">
          {{ tokenConfigured ? "已配置" : "未配置" }}
        </span>
      </div>

      <form
        v-if="tokenEditorOpen"
        class="site-token-form"
        @submit.prevent="submitToken"
      >
        <label>
          <span>模型密钥</span>
          <input
            v-model="tokenDraft"
            type="password"
            autocomplete="new-password"
            placeholder="请输入新官方小站模型密钥"
            :disabled="saving || refreshing"
          />
        </label>
        <div class="site-token-form-actions">
          <button
            type="button"
            :disabled="saving || refreshing"
            @click="closeTokenEditor"
          >
            取消
          </button>
          <button
            class="is-primary"
            type="submit"
            :disabled="saving || refreshing"
          >
            {{ saving ? "保存中…" : tokenConfigured ? "更新密钥" : "添加密钥" }}
          </button>
        </div>
      </form>

      <div v-else class="site-token-actions">
        <button
          class="is-primary"
          type="button"
          :disabled="saving || refreshing"
          @click="openTokenEditor"
        >
          <AppIcon name="plus" :size="15" />
          {{ tokenConfigured ? "更换密钥" : "添加密钥" }}
        </button>
        <button
          v-if="tokenConfigured"
          class="is-remove"
          type="button"
          :disabled="saving || refreshing"
          @click="emit('clearToken')"
        >
          移除密钥
        </button>
      </div>
    </section>

    <section class="site-quota-card" aria-label="新官方小站密钥额度">
      <div class="site-quota-heading">
        <div>
          <span>当前密钥剩余额度</span>
          <strong>{{
            quota?.unlimited ? "无限额度" : formatQuota(quota?.remaining)
          }}</strong>
        </div>
        <div>
          <span>已使用 / 总额度</span>
          <strong>
            {{
              quota?.unlimited
                ? `${formatQuota(quota.used)} / 无限`
                : `${formatQuota(quota?.used)} / ${formatQuota(quota?.total)}`
            }}
          </strong>
        </div>
      </div>
      <div
        v-if="!quota?.unlimited"
        class="site-quota-track"
        role="progressbar"
        aria-label="当前密钥额度使用进度"
        :aria-valuenow="quota ? quotaUsedPercentage : undefined"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: `${quotaUsedPercentage}%` }" />
      </div>
      <small>{{ quotaSummary() }}</small>
    </section>

    <section class="site-model-card" aria-labelledby="site-model-list-title">
      <header>
        <div>
          <span>模型目录</span>
          <h3 id="site-model-list-title">新小站提供模型</h3>
        </div>
        <span>
          {{
            configuredModels.length
              ? `${configuredModels.length} 个模型`
              : "等待配置"
          }}
        </span>
      </header>

      <article
        v-for="model in configuredModels"
        :key="model.id"
        class="site-model-row"
      >
        <span class="site-model-logo">{{
          model.label.slice(0, 1).toUpperCase()
        }}</span>
        <div class="site-model-details">
          <div class="site-model-title-row">
            <strong>{{ model.label }}</strong>
            <span class="site-model-available">可用</span>
          </div>
          <small>
            {{ model.provider }} · {{ model.modelId }} · {{ model.api }}
          </small>
          <small>{{ model.baseUrl }}</small>
          <small>
            输入 {{ formatPrice(model.input) }} / 输出
            {{ formatPrice(model.output) }} / 缓存
            {{ formatPrice(model.cache) }}（每百万 Token）
          </small>
        </div>
        <div class="site-model-actions">
          <button
            class="site-model-test"
            type="button"
            :disabled="saving || refreshing || testingModelId !== null"
            @click="testModel(model)"
          >
            {{ testingModelId === model.id ? "测试中…" : "测试联通" }}
          </button>
          <button
            class="site-model-toggle"
            type="button"
            role="switch"
            :aria-checked="model.enabled !== false"
            :aria-label="`${model.label}启用状态`"
            :disabled="saving || refreshing"
            @click="toggleModel(model)"
          >
            <span />
          </button>
        </div>
      </article>
      <p v-if="configuredModels.length === 0" class="site-model-empty">
        添加模型密钥后，新官方小站的相关模型会在这里出现。
      </p>
    </section>
  </section>
</template>

<style scoped src="./site-official-models-panel.css"></style>
