<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { ModelConfigInput } from "@deepwrite/contracts";
import { useJevModelEditor } from "../composables/useJevModelEditor";
import type { ModelEditorSavePayload } from "../composables/useModelEditor";
import type { DraftModel } from "./modelSettingsDraft";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.jevModelEditorPanel");
const tm = createScopedTranslator("components.modelEditorPanel");
const ts = createScopedTranslator("components.modelSettingsFeature");
const ta = createScopedTranslator("components.modelAdvancedConfigDialog");

const props = defineProps<{
  model: DraftModel;
  editing: boolean;
  saving: boolean;
  testingModelId: string | null;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [payload: ModelEditorSavePayload];
  test: [model: ModelConfigInput];
}>();

const {
  editor,
  providerOptions,
  modelIdOptions,
  showModelIdInput,
  canFetchModels,
  listing,
  setProvider,
  setModelId,
  useManualModelId,
  fetchModels,
  clearSavedKey,
  save,
  test
} = useJevModelEditor(props.model, {
  save: (payload) => emit("save", payload),
  test: (model) => emit("test", model)
});
</script>

<template>
  <section class="model-editor jev-model-editor" :inert="saving">
    <div class="model-editor-heading">
      <strong>{{ editing ? t("editJevModel") : t("addJevModel") }}</strong>
      <button type="button" @click="emit('cancel')">
        {{ tm("cancel") }}
      </button>
    </div>
    <p class="jev-model-intro">{{ t("intro") }}</p>
    <div class="model-form-grid">
      <label>
        <span>{{ tm("name") }}</span>
        <input
          v-model="editor.label"
          type="text"
          :placeholder="t('namePlaceholder')"
        />
      </label>
      <label>
        <span>Provider</span>
        <PopupSelect
          :model-value="editor.provider"
          :options="providerOptions"
          :accessible-label="tm('selectProvider')"
          :menu-min-width="260"
          @update:model-value="setProvider"
        />
      </label>
      <label>
        <span class="model-field-label">
          {{ tm("modelID") }}
          <span
            class="model-help-icon"
            tabindex="0"
            :aria-label="t('modelIdHelp')"
            :data-tooltip="t('modelIdHelp')"
            >!</span
          >
        </span>
        <div class="model-id-field">
          <input
            v-if="showModelIdInput"
            v-model="editor.modelId"
            type="text"
            :placeholder="tm('modelIDSuppliedByTheProvider')"
          />
          <PopupSelect
            v-else
            :model-value="editor.modelId"
            :options="modelIdOptions"
            :accessible-label="tm('selectModelID')"
            :menu-min-width="260"
            @update:model-value="setModelId"
          >
            <template #footer>
              <button
                class="remote-model-manual-button"
                type="button"
                @click="useManualModelId"
              >
                {{ tm("enterAnotherModelID") }}
              </button>
            </template>
          </PopupSelect>
          <button
            class="model-id-fetch-button"
            type="button"
            :disabled="listing || !canFetchModels"
            :title="
              canFetchModels
                ? tm('fetchAvailableModelsUsingTheAPIEndpointAndKey')
                : t('fetchUnsupported')
            "
            :aria-label="
              canFetchModels
                ? tm('fetchAvailableModelsUsingTheAPIEndpointAndKey')
                : t('fetchUnsupported')
            "
            @click="fetchModels"
          >
            {{ listing ? tm("fetchingLabel") : tm("fetch") }}
          </button>
        </div>
      </label>
      <label>
        <span class="model-field-label">
          {{ tm("aPIEndpoint") }}
          <span
            class="model-help-icon"
            tabindex="0"
            :aria-label="t('apiEndpointHelp')"
            :data-tooltip="t('apiEndpointHelp')"
            >!</span
          >
        </span>
        <input v-model="editor.baseUrl" type="url" placeholder="https://…/v1" />
      </label>
      <label class="is-wide">
        <span>API Key</span>
        <input
          v-model="editor.apiKey"
          type="password"
          :placeholder="
            editor.hasApiKey
              ? tm('savedSecurelyLeaveBlankToKeepUnchanged')
              : t('apiKeyPlaceholder')
          "
          autocomplete="new-password"
          @input="editor.clearApiKey = false"
        />
      </label>
    </div>

    <div v-if="editor.hasApiKey" class="model-key-row">
      <span>{{ tm("theExistingKeyWillBeKept") }}</span>
      <button type="button" @click="clearSavedKey">
        {{ tm("clearSavedKey") }}
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
          testingModelId === editor.id ? tm("testing") : ts("testConnection")
        }}
      </button>
      <button class="dialog-primary-button" type="button" @click="save">
        {{ saving ? tm("saving") : ta("save") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.jev-model-editor {
  container-type: inline-size;
}
.jev-model-intro {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.6;
}
.jev-model-editor .dialog-actions {
  flex-wrap: wrap;
}
@container (max-width: 34rem) {
  .model-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
