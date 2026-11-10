<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, watch } from "vue";
import type { ModelConfigInput } from "@deepwrite/contracts";
import {
  useModelEditor,
  type ModelEditorSavePayload
} from "../composables/useModelEditor";
import CreateCustomProviderDialog from "./CreateCustomProviderDialog.vue";
import type { DraftModel } from "./modelSettingsDraft";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.modelEditorPanel");

const props = withDefaults(
  defineProps<{
    model: DraftModel;
    editing: boolean;
    saving: boolean;
    testingModelId: string | null;
    knownUserProviders?: readonly string[];
  }>(),
  { knownUserProviders: () => [] }
);

const emit = defineEmits<{
  cancel: [];
  save: [payload: ModelEditorSavePayload];
  test: [model: ModelConfigInput];
}>();

const fetchHintConfirmButton = ref<HTMLButtonElement | null>(null);
const providerSelect = ref<InstanceType<typeof PopupSelect> | null>(null);
const createProviderOpen = ref(false);
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
  selectedRemoteModelIds,
  setSelectedRemoteModels,
  clearRemoteModels,
  fetchRemoteModels,
  applyProviderPreset,
  applyCustomProvider,
  setModelApi,
  setToolSchemaProfile,
  setDefaultThinkingLevel,
  setModelMode,
  toggleThinkingLevelOption,
  updateCustomThinkingLevel,
  save,
  test
} = useModelEditor(
  props.model,
  {
    save: (payload) => emit("save", payload),
    test: (model) => emit("test", model)
  },
  { knownUserProviders: () => props.knownUserProviders }
);

function openCreateProvider(): void {
  providerSelect.value?.closeMenu();
  createProviderOpen.value = true;
}

function submitCreateProvider(name: string): void {
  if (applyCustomProvider(name)) createProviderOpen.value = false;
}

watch(fetchHintDialog, (message) => {
  if (message) void nextTick(() => fetchHintConfirmButton.value?.focus());
});
</script>

<template>
  <section class="model-editor" :inert="saving">
    <div class="model-editor-heading">
      <strong>{{ editing ? t("editModel") : t("addModel") }}</strong>
      <button type="button" @click="emit('cancel')">
        {{ t("cancel") }}
      </button>
    </div>
    <div class="model-form-grid">
      <label>
        <span>{{ t("name") }}</span>
        <input
          v-model="editor.label"
          type="text"
          :placeholder="t('forExampleDeepSeekWritingLeaveBlankToUseThe')"
        />
      </label>
      <label>
        <span>Provider</span>
        <PopupSelect
          ref="providerSelect"
          :model-value="editor.provider"
          :options="providerOptions"
          :accessible-label="t('selectProvider')"
          @update:model-value="applyProviderPreset(String($event))"
        >
          <template #footer>
            <button
              class="remote-model-manual-button"
              type="button"
              @click="openCreateProvider"
            >
              {{ t("newProvider") }}
            </button>
          </template>
        </PopupSelect>
      </label>
      <label>
        <span>{{ t("modelID") }}</span>
        <div class="model-id-field">
          <PopupSelect
            v-if="canSelectRemoteModel"
            :model-value="editor.modelId"
            multiple
            :selected-values="selectedRemoteModelIds"
            :options="remoteModelOptions"
            :accessible-label="t('selectModelID')"
            :placeholder="t('selectModelsToSave')"
            :menu-min-width="280"
            :disabled="listingRemoteModels"
            @update:selected-values="setSelectedRemoteModels"
          >
            <template #footer>
              <button
                class="remote-model-manual-button"
                type="button"
                @click="clearRemoteModels"
              >
                {{ t("enterAnotherModelID") }}
              </button>
            </template>
          </PopupSelect>
          <input
            v-else
            v-model="editor.modelId"
            type="text"
            :placeholder="t('modelIDSuppliedByTheProvider')"
          />
          <button
            class="model-id-fetch-button"
            type="button"
            :disabled="listingRemoteModels"
            :title="
              listingRemoteModels
                ? t('fetching')
                : t('fetchAvailableModelsUsingTheAPIEndpointAndKey')
            "
            :aria-label="
              listingRemoteModels
                ? t('fetchingLabel')
                : t('fetchAvailableModels')
            "
            @click="fetchRemoteModels"
          >
            {{ listingRemoteModels ? t("fetchingLabel") : t("fetch") }}
          </button>
        </div>
      </label>
      <label>
        <span>{{ t("aPIType") }}</span>
        <PopupSelect
          :model-value="editor.api"
          :options="apiOptions"
          :accessible-label="t('selectAPIType')"
          :menu-min-width="240"
          @update:model-value="setModelApi"
        />
      </label>
      <label>
        <span>{{ t("aPIEndpoint") }}</span>
        <input
          v-model="editor.baseUrl"
          type="url"
          :placeholder="t('optionalForBuiltInModelsRequiredForCustomServices')"
        />
      </label>
      <label>
        <span>{{ t("toolSchema") }}</span>
        <PopupSelect
          :model-value="editor.toolSchemaProfile ?? 'auto'"
          :options="toolSchemaProfileOptions"
          :accessible-label="t('selectToolSchemaCompatibilityMode')"
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
              ? t('savedSecurelyLeaveBlankToKeepUnchanged')
              : t('enterAPIKeyOptionalForLocalServices')
          "
          autocomplete="new-password"
          @input="editor.clearApiKey = false"
        />
      </label>
      <label>
        <span>{{ t("modelMode") }}</span>
        <PopupSelect
          :model-value="editor.reasoning ? 'reasoning' : 'temperature'"
          :options="modelModeOptions"
          :accessible-label="t('selectModelMode')"
          @update:model-value="
            setModelMode(String($event) as 'reasoning' | 'temperature')
          "
        />
      </label>
      <label v-if="editor.reasoning">
        <span>{{ t("defaultReasoningLevel") }}</span>
        <PopupSelect
          :model-value="editor.defaultThinkingLevel"
          :options="defaultThinkingOptions"
          :accessible-label="t('selectDefaultReasoningLevel')"
          @update:model-value="setDefaultThinkingLevel"
        />
      </label>
      <label v-else>
        <span class="model-field-label">
          {{ t("temperatureOptions") }}
          <span
            class="model-help-icon"
            tabindex="0"
            :aria-label="
              t(
                'lowerTemperaturesProduceMoreStablePredictableOutputHigherTemperatures'
              )
            "
            :data-tooltip="
              t('lowerTemperaturesAreMorePredictableHigherTemperaturesAreMore')
            "
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
            :aria-label="
              t('temperatureOptionValue', {
                arg0: index + 1
              })
            "
          />
        </span>
      </label>
      <label v-if="editor.reasoning" class="is-wide">
        <span>{{ t("reasoningLevelOptions") }}</span>
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
            <span>{{ t("custom") }}</span>
            <input
              :value="editor.customThinkingLevel"
              type="text"
              maxlength="64"
              :placeholder="t('forExampleUltra')"
              :aria-label="t('customReasoningLevelValueInEnglish')"
              @input="updateCustomThinkingLevel"
            />
          </span>
        </span>
      </label>
    </div>

    <div v-if="editor.hasApiKey" class="model-key-row">
      <span>{{ t("theExistingKeyWillBeKept") }}</span>
      <button
        type="button"
        @click="
          editor.hasApiKey = false;
          editor.clearApiKey = true;
          editor.apiKey = '';
        "
      >
        {{ t("clearSavedKey") }}
      </button>
    </div>
    <div class="dialog-actions">
      <button
        class="dialog-secondary-button"
        type="button"
        :disabled="testingModelId !== null"
        @click="test"
      >
        {{
          testingModelId === editor.id ? t("testing") : t("testCurrentValues")
        }}
      </button>
      <button class="dialog-primary-button" type="button" @click="save">
        {{ saving ? t("saving") : t("applyAndSaveConfigurations") }}
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
            <span class="dialog-eyebrow">{{ t("modelSettings") }}</span>
            <h2 id="model-fetch-hint-title">
              {{ t("couldNotFetchModels") }}
            </h2>
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
            {{ t("gotIt") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>

  <CreateCustomProviderDialog
    :open="createProviderOpen"
    @close="createProviderOpen = false"
    @submit="submitCreateProvider"
  />
</template>

<style scoped>
.model-editor {
  container-type: inline-size;
}
.model-editor .dialog-actions {
  flex-wrap: wrap;
}
@container (max-width: 34rem) {
  .model-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.model-editor .dialog-primary-button {
  background: var(--neutral-solid);
  color: var(--surface-main);
}

.remote-model-manual-button {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font-size: 0.928571rem;
  cursor: pointer;
}
.remote-model-manual-button:hover,
.remote-model-manual-button:focus-visible {
  background: var(--surface-hover);
}
</style>
