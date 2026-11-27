<script setup lang="ts">
import type {
  ShortAgentSubagentModelMode,
  ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import AgentTeamSegmented from "./AgentTeamSegmented.vue";
import ConversationModelConfigSelect from "./ConversationModelConfigSelect.vue";
import type { PopupSelectOption } from "./PopupSelect.vue";

const t = createScopedTranslator("components.subagentModelField");

const props = defineProps<{
  name: string;
  modelMode?: ShortAgentSubagentModelMode | undefined;
  modelId?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  temperature?: number | undefined;
  modelOptions: readonly (ModelSelectOption | PopupSelectOption)[];
  thinkingOptions: readonly PopupSelectOption[];
  temperatureOptions: readonly PopupSelectOption[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  setMode: [mode: ShortAgentSubagentModelMode];
  setModelId: [modelId: string];
  setThinkingLevel: [level: string];
  setTemperature: [temperature: number];
}>();

const custom = computed(() => props.modelMode === "custom");
const modeOptions = computed(() => [
  { value: "inherit" as const, label: t("usePrimaryAgentModel") },
  { value: "custom" as const, label: t("configureModelSeparately") }
]);
const normalizedThinkingOptions = computed(() =>
  props.thinkingOptions.map((option) => ({
    value: String(option.value) as ThinkingLevel,
    label: option.label
  }))
);
const normalizedTemperatureOptions = computed(() =>
  props.temperatureOptions.map((option) => ({
    value: Number(option.value),
    label: option.label
  }))
);
</script>

<template>
  <div class="model-field">
    <span class="model-field-label">{{ t("modelSettings") }}</span>
    <AgentTeamSegmented
      :model-value="custom ? 'custom' : 'inherit'"
      :options="modeOptions"
      :name="name"
      :label="t('subagentModelSettings')"
      :disabled="disabled"
      @update:model-value="emit('setMode', $event)"
    />
    <div v-if="custom" class="model-run-settings">
      <ConversationModelConfigSelect
        class="model-select"
        variant="field"
        hides-web-search
        :menu-z-index="1200"
        :selected-model-id="modelId ?? ''"
        :model-options="modelOptions"
        :thinking-level="thinkingLevel ?? 'medium'"
        :thinking-options="normalizedThinkingOptions"
        :shows-temperature="thinkingLevel === 'off'"
        :temperature="temperature ?? 0.7"
        :temperature-options="normalizedTemperatureOptions"
        :accessible-label="t('selectSubagentModel')"
        :placeholder="t('selectAModel')"
        :disabled="disabled || modelOptions.length === 0"
        @select-model="emit('setModelId', $event)"
        @select-thinking="emit('setThinkingLevel', $event)"
        @select-temperature="emit('setTemperature', $event)"
      />
    </div>
    <p v-if="custom && modelOptions.length === 0" class="model-empty-hint">
      {{ t("noModelsAvailableAddOneInModelSettingsFirst") }}
    </p>
  </div>
</template>

<style scoped>
.model-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: start;
  min-width: 0;
  gap: 6px;
}
.model-field :deep(.segmented) {
  flex-wrap: wrap;
}
.model-field-label {
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 620;
}
.model-run-settings {
  width: 100%;
  margin-top: 2px;
}
.model-select {
  min-width: 0;
  width: 100%;
}
.model-empty-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  line-height: 1.45;
}
</style>
