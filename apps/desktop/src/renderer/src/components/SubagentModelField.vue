<script setup lang="ts">
import type {
  ShortAgentSubagentModelMode,
  ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import AgentTeamSegmented from "./AgentTeamSegmented.vue";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const t = createScopedTranslator("components.subagentModelField");

const props = defineProps<{
  name: string;
  modelMode?: ShortAgentSubagentModelMode | undefined;
  modelId?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  temperature?: number | undefined;
  modelOptions: readonly PopupSelectOption[];
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
      <PopupSelect
        class="model-select"
        :model-value="modelId ?? ''"
        :options="[...modelOptions]"
        :accessible-label="t('selectSubagentModel')"
        :placeholder="t('selectAModel')"
        size="large"
        :disabled="disabled || modelOptions.length === 0"
        :menu-min-width="260"
        :menu-max-height="520"
        :menu-z-index="1200"
        @update:model-value="emit('setModelId', String($event))"
      >
        <template #prefix><AppIcon name="model" :size="14" /></template>
      </PopupSelect>
      <PopupSelect
        class="model-select"
        :model-value="thinkingLevel ?? ''"
        :options="[...thinkingOptions]"
        :accessible-label="t('selectReasoningLevel')"
        :placeholder="t('selectAReasoningLevel')"
        size="large"
        :disabled="disabled || !modelId"
        :menu-min-width="200"
        :menu-z-index="1200"
        @update:model-value="emit('setThinkingLevel', String($event))"
      >
        <template #prefix><AppIcon name="brain" :size="14" /></template>
      </PopupSelect>
      <PopupSelect
        v-if="thinkingLevel === 'off'"
        class="model-select"
        :model-value="temperature ?? ''"
        :options="[...temperatureOptions]"
        :accessible-label="t('selectTemperature')"
        :placeholder="t('selectATemperature')"
        size="large"
        :disabled="disabled || !modelId"
        :menu-min-width="180"
        :menu-z-index="1200"
        @update:model-value="emit('setTemperature', Number($event))"
      >
        <template #prefix><AppIcon name="temperature" :size="14" /></template>
      </PopupSelect>
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
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
