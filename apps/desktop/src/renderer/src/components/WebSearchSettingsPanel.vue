<script setup lang="ts">
import { computed, onMounted } from "vue";
import { WEB_SEARCH_PROVIDER_IDS } from "@deepwrite/contracts/renderer";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import PopupSelect from "./PopupSelect.vue";
import WebSearchKeyImportDialog from "./WebSearchKeyImportDialog.vue";
import {
  useWebSearchSettings,
  webSearchProviderLabel
} from "../composables/useWebSearchSettings";
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.webSearchSettings");
const c = useWebSearchSettings();
const { settings, draft, loaded, importRequest } = c;

const providerOptions = computed(() =>
  WEB_SEARCH_PROVIDER_IDS.map((id) => ({
    value: id,
    label: webSearchProviderLabel(id)
  }))
);
const keyPlaceholder = computed(() =>
  c.profile.value?.hasApiKey && !draft.clearKey
    ? t("keyPlaceholderSaved")
    : c.descriptor.value.requiresApiKey === false
      ? t("optionalKey")
      : t("keyPlaceholderEmpty")
);
const keyNote = computed(() =>
  draft.clearKey ? t("keyNotSaved") : c.keySourceText.value
);

onMounted(() => void c.load());
</script>

<template>
  <section
    class="settings-group web-search-panel"
    :class="{ 'is-pending': c.loading.value && !loaded }"
  >
    <p class="web-search-intro">{{ t("intro") }}</p>

    <h2 class="settings-group-title">{{ t("serviceTitle") }}</h2>
    <div class="settings-card">
      <div class="settings-item web-search-row">
        <span class="settings-item-text">
          <strong>{{ t("enable") }}</strong>
          <small aria-live="polite">{{ c.statusText.value }}</small>
        </span>
        <AgentTeamSwitch
          :model-value="settings?.enabled ?? false"
          :disabled="!loaded"
          :label="t('enable')"
          @update:model-value="c.setEnabled($event)"
        />
      </div>

      <div class="settings-item web-search-row">
        <span class="settings-item-text">
          <strong>{{ t("provider") }}</strong>
        </span>
        <PopupSelect
          class="general-select-control"
          :model-value="draft.activeProviderId"
          :options="providerOptions"
          :accessible-label="t('provider')"
          align="end"
          :disabled="!loaded"
          @update:model-value="
            c.selectProvider(
              WEB_SEARCH_PROVIDER_IDS.find((id) => id === $event) ??
                draft.activeProviderId
            )
          "
        />
      </div>

      <label class="settings-item web-search-key-row" for="web-search-base-url">
        <span class="settings-item-text">
          <strong>{{ t("baseUrl") }}</strong>
          <small>{{
            t(
              c.descriptor.value.requiresApiKey === false
                ? "selfHostedHint"
                : "baseUrlHint"
            )
          }}</small>
        </span>
        <input
          id="web-search-base-url"
          v-model="draft.baseUrl"
          class="voice-input web-search-key-input"
          type="url"
          :placeholder="c.descriptor.value.defaultBaseUrl"
          :disabled="!loaded"
          @change="c.save()"
          @keydown.enter="c.save()"
        />
      </label>

      <div class="settings-item web-search-key-row">
        <div class="web-search-key-heading">
          <label class="settings-item-text" for="web-search-api-key">
            <strong>{{ t("apiKey") }}</strong>
          </label>
          <button
            v-if="c.profile.value?.hasApiKey"
            class="voice-text-button"
            type="button"
            :disabled="!loaded || draft.clearKey"
            @click="c.clearKey"
          >
            {{ t("clearKey") }}
          </button>
        </div>
        <input
          id="web-search-api-key"
          v-model="draft.apiKey"
          class="voice-input web-search-key-input"
          type="password"
          autocomplete="off"
          aria-describedby="web-search-key-source"
          :placeholder="keyPlaceholder"
          :disabled="!loaded"
          @input="draft.clearKey = false"
          @change="c.save()"
          @keydown.enter="c.save()"
        />
        <small id="web-search-key-source" class="web-search-key-source">{{
          keyNote
        }}</small>
        <div class="web-search-key-actions">
          <button
            v-if="c.canImport.value"
            class="voice-button"
            type="button"
            :disabled="!loaded || c.importing.value"
            @click="c.startImport"
          >
            {{
              c.importing.value
                ? t("importing")
                : t("importFrom", { provider: c.provider.value })
            }}
          </button>
          <button
            class="voice-button"
            type="button"
            :disabled="!loaded || c.testing.value"
            @click="c.test"
          >
            {{ c.testing.value ? t("testing") : t("testSearch") }}
          </button>
          <button
            v-if="!loaded && !c.loading.value"
            class="voice-button"
            type="button"
            @click="c.load"
          >
            {{ t("reload") }}
          </button>
        </div>
      </div>
    </div>

    <h2 class="settings-group-title">{{ t("parametersTitle") }}</h2>
    <div class="settings-card">
      <label class="settings-item web-search-row">
        <span class="settings-item-text">
          <strong>{{ t("maxResults") }}</strong>
          <small>{{
            t("maxResultsHint", { min: 1, max: c.limits.value.maxResults })
          }}</small>
        </span>
        <input
          v-model.number="draft.maxResults"
          class="voice-input web-search-number"
          type="number"
          inputmode="numeric"
          step="1"
          :min="1"
          :max="c.limits.value.maxResults"
          :disabled="!loaded"
          @change="c.save()"
          @keydown.enter="c.save()"
        />
      </label>
      <label class="settings-item web-search-row">
        <span class="settings-item-text">
          <strong>{{ t("perRunCallLimit") }}</strong>
          <small>{{
            t("perRunCallLimitHint", {
              min: c.limits.value.minCalls,
              max: c.limits.value.maxCalls
            })
          }}</small>
        </span>
        <input
          v-model.number="draft.perRunCallLimit"
          class="voice-input web-search-number"
          type="number"
          inputmode="numeric"
          step="1"
          :min="c.limits.value.minCalls"
          :max="c.limits.value.maxCalls"
          :disabled="!loaded"
          @change="c.save()"
          @keydown.enter="c.save()"
        />
      </label>
    </div>

    <WebSearchKeyImportDialog
      :request="importRequest"
      :provider-label="c.provider.value"
      :busy="c.importConfirming.value"
      @close="c.cancelImport"
      @confirm="c.confirmImport"
    />
  </section>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped src="./voice-settings.css"></style>
<style scoped src="./web-search-settings.css"></style>
