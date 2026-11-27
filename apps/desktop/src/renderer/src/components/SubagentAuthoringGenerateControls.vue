<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import ConversationModelConfigSelect from "./ConversationModelConfigSelect.vue";
import type { PopupSelectOption } from "./PopupSelect.vue";

const t = createScopedTranslator(
  "components.subagentAuthoringGenerateControls"
);

const modelId = defineModel<string>({ required: true });
defineProps<{
  modelOptions: readonly (ModelSelectOption | PopupSelectOption)[];
  generating: boolean;
  canGenerate: boolean;
  statusText: string | null;
  error: string | null;
}>();

const emit = defineEmits<{ generate: []; stop: [] }>();
</script>

<template>
  <div class="generate-controls">
    <div class="form-field">
      <span>{{ t("generationModel") }}</span>
      <ConversationModelConfigSelect
        variant="field"
        hides-web-search
        close-on-model-select
        :menu-z-index="1200"
        :selected-model-id="modelId"
        :model-options="modelOptions"
        :thinking-options="[]"
        :accessible-label="t('generationModel')"
        :disabled="generating || !modelOptions.length"
        :placeholder="t('selectModel')"
        @select-model="modelId = $event"
      />
    </div>
    <div class="generate-row">
      <button
        type="button"
        class="dialog-primary-button"
        :disabled="!canGenerate"
        @click="emit('generate')"
      >
        {{ generating ? t("generating") : t("generateSubagentDraft") }}
      </button>
      <button
        type="button"
        class="dialog-secondary-button authoring-stop-button"
        :class="{ 'is-placeholder': !generating }"
        :disabled="!generating"
        :aria-hidden="!generating"
        @click="emit('stop')"
      >
        {{ t("stop") }}
      </button>
    </div>
    <div class="authoring-status-slot" aria-live="polite">
      <p v-if="statusText && !error" class="status-text" :title="statusText">
        {{ statusText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.generate-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.form-field {
  display: grid;
  gap: 6px;
}
.form-field > span {
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 620;
}
.generate-row {
  display: flex;
  gap: 8px;
}
.generate-row button {
  min-height: 36px;
}
.generate-row .dialog-primary-button {
  flex: 1;
}
.authoring-stop-button.is-placeholder {
  visibility: hidden;
}
.authoring-status-slot {
  height: 2.65rem;
  overflow: hidden;
}
.status-text {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.821429rem;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
