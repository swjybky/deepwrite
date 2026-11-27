<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator, locale } from "../i18n";
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
import ModelTestStatusNote from "./ModelTestStatusNote.vue";
import SiteOfficialQuotaMergeDialog from "./SiteOfficialQuotaMergeDialog.vue";
import SiteOfficialTokenCard from "./SiteOfficialTokenCard.vue";
import { useSettingsStore } from "../stores/settingsStore";
import { useSiteOfficialQuotaMerge } from "../composables/useSiteOfficialQuotaMerge";
import { toModelInput } from "./modelSettingsDraft";
import {
  isModelTestActiveStatus,
  modelTestConfigSignature,
  type ModelTestStateEntry
} from "../utils/modelTestState";

const t = createScopedTranslator("components.siteOfficialModelsPanel");

const props = withDefaults(
  defineProps<{
    settings: ModelSettings | null;
    saving: boolean;
    refreshing: boolean;
    quota: SiteOfficialQuota | null;
    testingModelId: string | null;
    modelTestStates?: Readonly<Record<string, ModelTestStateEntry>>;
  }>(),
  {
    modelTestStates: () => ({})
  }
);

const emit = defineEmits<{
  saveToken: [apiKey: string];
  clearToken: [];
  refresh: [];
  setModelEnabled: [payload: { modelId: string; enabled: boolean }];
  test: [model: ModelConfigInput];
  cancelTest: [modelId: string];
}>();

const quotaMerge = useSiteOfficialQuotaMerge({
  api: () => deepwriteApi(),
  settingsStore: useSettingsStore(),
  notifications: uiMessage
});
const quotaMergeTrigger = ref<HTMLButtonElement | null>(null);
const {
  open: mergeOpen,
  sourceKey,
  pending: mergePending,
  disabledReason: mergeDisabledReason
} = quotaMerge;
const controlsBusy = computed(
  () =>
    props.saving || props.refreshing || mergeOpen.value || mergePending.value
);
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

function testModel(model: ModelConfig): void {
  emit("test", toModelInput(model));
}

function modelTestEntry(id: string): ModelTestStateEntry | undefined {
  return props.modelTestStates[id];
}

function isModelTesting(id: string): boolean {
  const entry = modelTestEntry(id);
  if (entry) return isModelTestActiveStatus(entry.status);
  return props.testingModelId === id;
}

function isModelCancelling(id: string): boolean {
  return modelTestEntry(id)?.status === "cancelling";
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
  return new Intl.NumberFormat(locale.value, {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function quotaSummary(): string {
  if (!props.quota) {
    return tokenConfigured.value
      ? t("quotaInformationIsUnavailableRefreshThePageUsingThe")
      : t("addAModelKeyToViewQuotaProgress");
  }
  if (props.quota.unlimited) return t("theCurrentKeyHasUnlimitedQuota");
  return t("valueOfQuotaUsed", {
    arg0: quotaUsedPercentage.value.toFixed(1)
  });
}
</script>

<template>
  <section class="site-models-panel" aria-labelledby="site-models-title">
    <header class="site-models-header">
      <div>
        <span class="site-models-kicker">
          <AppIcon name="model" :size="15" />
          {{ t("deepWriteOfficialSite") }}
        </span>
        <h2 id="site-models-title">
          {{ t("officialSiteModelsAndKey") }}
        </h2>
        <p>
          {{ t("connectToTheDeepWriteApiGatewayUsingAModelKey") }}
        </p>
      </div>
      <div class="site-models-header-actions">
        <a
          class="site-shop-button"
          href="https://pay.ldxp.cn/shop/UKGFTY58"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('openSiteStoreInBrowser')"
        >
          <AppIcon name="globe" :size="15" />
          {{ t("siteStore") }}
        </a>
        <button
          class="site-models-refresh"
          type="button"
          :disabled="controlsBusy"
          @click="emit('refresh')"
        >
          <AppIcon name="history" :size="15" />
          {{ refreshing ? t("refreshing") : t("refreshPage") }}
        </button>
      </div>
    </header>

    <SiteOfficialTokenCard
      :configured="tokenConfigured"
      :enabled-model-count="enabledModelCount"
      :busy="controlsBusy"
      :saving="saving"
      @save-token="emit('saveToken', $event)"
      @clear-token="emit('clearToken')"
    />

    <section class="site-quota-card" :aria-label="t('officialSiteKeyQuota')">
      <div class="site-quota-heading">
        <div>
          <span>{{ t("currentKeyBalance") }}</span>
          <strong>{{
            quota?.unlimited
              ? t("unlimitedQuota")
              : formatQuota(quota?.remaining)
          }}</strong>
        </div>
        <div>
          <span>{{ t("usedTotalQuota") }}</span>
          <strong>
            {{
              quota?.unlimited
                ? t("valueUnlimited", {
                    arg0: formatQuota(quota.used)
                  })
                : `${formatQuota(quota?.used)} / ${formatQuota(quota?.total)}`
            }}
          </strong>
        </div>
      </div>
      <div
        v-if="!quota?.unlimited"
        class="site-quota-track"
        role="progressbar"
        :aria-label="t('currentKeyQuotaProgress')"
        :aria-valuenow="quota ? quotaUsedPercentage : undefined"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: `${quotaUsedPercentage}%` }" />
      </div>
      <div class="site-quota-footer">
        <small>{{ quotaSummary() }}</small>
        <button
          ref="quotaMergeTrigger"
          class="site-models-refresh"
          type="button"
          :disabled="!!mergeDisabledReason || controlsBusy"
          :title="
            mergeDisabledReason || t('transferTheSourceKeySRemainingQuotaToThe')
          "
          @click="quotaMerge.show"
        >
          {{ t("addQuota") }}
        </button>
      </div>
    </section>

    <section class="site-model-card" aria-labelledby="site-model-list-title">
      <header>
        <div>
          <span>{{ t("modelCatalog") }}</span>
          <h3 id="site-model-list-title">
            {{ t("modelsFromTheOfficialSite") }}
          </h3>
        </div>
        <span>
          {{
            configuredModels.length
              ? t("valueModels", {
                  arg0: configuredModels.length
                })
              : t("awaitingConfiguration")
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
            <strong :title="model.label">{{ model.label }}</strong>
            <span class="site-model-available">{{ t("available") }}</span>
            <span
              v-if="model.description?.trim()"
              class="site-model-description"
              :title="model.description"
            >
              {{ model.description }}
            </span>
          </div>
          <small>
            {{ model.provider }} · {{ model.modelId }} · {{ model.api }}
          </small>
          <small>{{ model.baseUrl }}</small>
          <small>
            {{
              t("inputOutputCachePerMillionTokensMessage", {
                arg0: formatPrice(model.input) ?? "",
                arg1: formatPrice(model.output) ?? "",
                arg2: formatPrice(model.cache) ?? ""
              })
            }}
          </small>
          <ModelTestStatusNote
            :entry="modelTestEntry(model.id)"
            :current-signature="modelTestConfigSignature(model)"
          />
        </div>
        <div class="site-model-actions">
          <button
            class="site-model-test"
            type="button"
            :disabled="
              controlsBusy || isModelTesting(model.id) || !model.hasApiKey
            "
            :aria-busy="isModelTesting(model.id)"
            @click="testModel(model)"
          >
            {{ isModelTesting(model.id) ? t("testing") : t("testConnection") }}
          </button>
          <button
            v-if="isModelTesting(model.id)"
            class="site-model-test"
            type="button"
            :disabled="controlsBusy || isModelCancelling(model.id)"
            @click="emit('cancelTest', model.id)"
          >
            {{
              isModelCancelling(model.id) ? t("cancelingTest") : t("cancelTest")
            }}
          </button>
          <button
            class="site-model-toggle"
            type="button"
            role="switch"
            :aria-checked="model.enabled !== false"
            :aria-label="
              t('valueEnabledStatus', {
                arg0: model.label
              })
            "
            :disabled="controlsBusy || !model.hasApiKey"
            @click="toggleModel(model)"
          >
            <span />
          </button>
        </div>
      </article>
      <p v-if="configuredModels.length === 0" class="site-model-empty">
        {{ t("officialSiteModelsAppearHereAfterYouAddA") }}
      </p>
    </section>
    <SiteOfficialQuotaMergeDialog
      v-if="mergeOpen"
      v-model:source-key="sourceKey"
      :pending="mergePending"
      :return-focus="quotaMergeTrigger"
      @close="quotaMerge.close"
      @submit="quotaMerge.submit"
    />
  </section>
</template>

<style scoped src="./site-official-models-panel.css"></style>
