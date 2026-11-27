<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type {
  ModelConfig,
  ModelConfigInput,
  ModelSettings
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import ModelAnnouncementNotice from "./ModelAnnouncementNotice.vue";
import ModelTestStatusNote from "./ModelTestStatusNote.vue";
import { freeModelStatus, isFreeModelAvailable } from "./freeModelPresentation";
import { toModelInput } from "./modelSettingsDraft";
import {
  isModelTestActiveStatus,
  modelTestConfigSignature,
  type ModelTestStateEntry
} from "../utils/modelTestState";

const t = createScopedTranslator("components.freeModelsPanel");

const props = withDefaults(
  defineProps<{
    settings: ModelSettings | null;
    refreshing: boolean;
    saving: boolean;
    testingModelId: string | null;
    modelTestStates?: Readonly<Record<string, ModelTestStateEntry>>;
    modelAlertMessages: readonly string[];
  }>(),
  {
    modelTestStates: () => ({})
  }
);

const emit = defineEmits<{
  refresh: [];
  setModelEnabled: [payload: { modelId: string; enabled: boolean }];
  test: [model: ModelConfigInput];
  cancelTest: [modelId: string];
  openOfficialModels: [];
}>();

const currentModels = computed(() => props.settings?.deepwriteFreeModels ?? []);
const currentModelIds = computed(
  () => new Set(currentModels.value.map((model) => model.id))
);
const deprecatedModels = computed(() =>
  (props.settings?.deepwriteFreeDeprecatedModels ?? []).filter(
    (model) => !currentModelIds.value.has(model.id)
  )
);
const enabledModelIds = computed(
  () => new Set(props.settings?.deepwriteFreeEnabledModelIds ?? [])
);

function toggleModel(model: ModelConfig, event: Event): void {
  emit("setModelEnabled", {
    modelId: model.id,
    enabled: (event.target as HTMLInputElement).checked
  });
}

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
</script>

<template>
  <section class="free-models-panel" aria-labelledby="free-models-title">
    <header class="free-models-header">
      <div>
        <span class="free-models-kicker">
          <AppIcon name="model" :size="15" />
          {{ t("deepWriteFreeModels") }}
        </span>
        <h2 id="free-models-title">
          {{ t("freeModels") }}
        </h2>
        <ModelAnnouncementNotice
          class="free-models-notice"
          :messages="modelAlertMessages"
          @open-official-models="emit('openOfficialModels')"
        />
      </div>
      <button
        class="free-models-refresh"
        type="button"
        :disabled="refreshing || saving"
        @click="emit('refresh')"
      >
        <AppIcon name="history" :size="15" />
        {{ refreshing ? t("refreshing") : t("refreshList") }}
      </button>
    </header>

    <p v-if="settings?.deepwriteFreeMessage" class="free-models-message">
      {{ settings.deepwriteFreeMessage }}
    </p>

    <div v-if="refreshing && !settings" class="free-models-empty">
      {{ t("fetchingFreeModels") }}
    </div>
    <template v-else>
      <section class="free-models-group" aria-labelledby="current-free-models">
        <header>
          <div>
            <span>{{ t("currentCatalog") }}</span>
            <h3 id="current-free-models">
              {{ t("availableModels") }}
            </h3>
          </div>
          <span>{{
            t("modelsMessage", {
              arg0: currentModels.length ?? ""
            })
          }}</span>
        </header>

        <div v-if="currentModels.length" class="free-models-list">
          <article
            v-for="model in currentModels"
            :key="model.id"
            class="free-model-card"
            :class="{ 'is-unavailable': !isFreeModelAvailable(model) }"
          >
            <span class="free-model-logo">{{
              model.label.slice(0, 1).toUpperCase()
            }}</span>
            <div class="free-model-details">
              <div class="free-model-title-row">
                <strong>{{ model.label }}</strong>
                <span
                  class="free-model-status"
                  :class="{ 'is-available': isFreeModelAvailable(model) }"
                >
                  {{ freeModelStatus(model) }}
                </span>
              </div>
              <small>{{ model.provider }} · {{ model.modelId }}</small>
              <small>{{ model.api }} · {{ model.id }}</small>
              <ModelTestStatusNote
                :entry="modelTestEntry(model.id)"
                :current-signature="modelTestConfigSignature(model)"
              />
            </div>
            <div class="free-model-actions">
              <button
                v-if="isFreeModelAvailable(model)"
                class="free-model-test"
                type="button"
                :disabled="saving || refreshing || isModelTesting(model.id)"
                :aria-busy="isModelTesting(model.id)"
                :aria-label="
                  t('testValueConnection', {
                    arg0: model.label
                  })
                "
                @click="testModel(model)"
              >
                {{
                  isModelTesting(model.id) ? t("testing") : t("testConnection")
                }}
              </button>
              <button
                v-if="isFreeModelAvailable(model) && isModelTesting(model.id)"
                class="free-model-test"
                type="button"
                :disabled="isModelCancelling(model.id)"
                :aria-label="
                  t('cancelValueConnectionTest', {
                    arg0: model.label
                  })
                "
                @click="emit('cancelTest', model.id)"
              >
                {{
                  isModelCancelling(model.id)
                    ? t("cancelingTest")
                    : t("cancelTest")
                }}
              </button>
              <label class="free-model-toggle">
                <input
                  type="checkbox"
                  :checked="enabledModelIds.has(model.id)"
                  :disabled="
                    saving || refreshing || !isFreeModelAvailable(model)
                  "
                  :aria-label="
                    t('valueValue', {
                      arg0: enabledModelIds.has(model.id)
                        ? t('disable')
                        : t('enable'),
                      arg1: model.label
                    })
                  "
                  @change="toggleModel(model, $event)"
                />
                <span aria-hidden="true" />
              </label>
            </div>
          </article>
        </div>
        <p v-else class="free-models-empty">
          {{ t("noFreeModelsAvailableToConfigure") }}
        </p>
      </section>

      <section
        v-if="deprecatedModels.length"
        class="free-models-group is-deprecated"
        aria-labelledby="deprecated-free-models"
      >
        <header>
          <div>
            <span>{{ t("history") }}</span>
            <h3 id="deprecated-free-models">
              {{ t("retiredModels") }}
            </h3>
          </div>
          <span>{{
            t("modelsMessage", {
              arg0: deprecatedModels.length ?? ""
            })
          }}</span>
        </header>
        <div class="free-models-list">
          <article
            v-for="model in deprecatedModels"
            :key="model.id"
            class="free-model-card is-unavailable"
          >
            <span class="free-model-logo">{{
              model.label.slice(0, 1).toUpperCase()
            }}</span>
            <div class="free-model-details">
              <div class="free-model-title-row">
                <strong>{{ model.label }}</strong>
                <span class="free-model-status is-deprecated">{{
                  t("retired")
                }}</span>
              </div>
              <small>{{ model.provider }} · {{ model.modelId }}</small>
              <small>{{ model.api }} · {{ model.id }}</small>
            </div>
            <label
              class="free-model-toggle"
              :title="t('retiredModelsCannotBeEnabled')"
            >
              <input
                type="checkbox"
                disabled
                :aria-label="
                  t('valueIsRetired', {
                    arg0: model.label
                  })
                "
              />
              <span aria-hidden="true" />
            </label>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped src="./free-models-panel.css"></style>
