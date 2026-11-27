<script setup lang="ts">
import {
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  type ShortAgentSubagentDefinition,
  type ShortAgentSubagentModelMode,
  type SubagentAgentMode,
  type SubagentDrawSettings,
  type SubagentWebSearchMode
} from "@deepwrite/contracts/renderer";
import { computed, ref, useId } from "vue";
import { createScopedTranslator } from "../i18n";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import AppIcon from "./AppIcon.vue";
import type { PopupSelectOption } from "./PopupSelect.vue";
import SubagentDrawField from "./SubagentDrawField.vue";
import SubagentModeField from "./SubagentModeField.vue";
import SubagentModelField from "./SubagentModelField.vue";
import SubagentWebSearchField from "./SubagentWebSearchField.vue";
import {
  SUBAGENT_AGENT_MODE_LABELS,
  SUBAGENT_WEB_SEARCH_LABELS
} from "./agentTeamSettingsMeta";
import type { SubagentModelConfig } from "./useSubagentModelConfig";

const t = createScopedTranslator("components.agentTeamSubagentEditor");

const name = defineModel<string>("name", { required: true });
const description = defineModel<string>("description", { required: true });
const systemPrompt = defineModel<string>("systemPrompt", { required: true });
const agentMode = defineModel<SubagentAgentMode>("agentMode", {
  required: true
});
const webSearchMode = defineModel<SubagentWebSearchMode | undefined>(
  "webSearchMode",
  { required: true }
);
const draw = defineModel<SubagentDrawSettings | undefined>("draw", {
  required: true
});

const props = defineProps<{
  subagent: ShortAgentSubagentDefinition;
  disabled: boolean;
  readOnly?: boolean;
  modelOptions: readonly (ModelSelectOption | PopupSelectOption)[];
  thinkingOptions: readonly PopupSelectOption[];
  temperatureOptions: readonly PopupSelectOption[];
  modelConfig: SubagentModelConfig;
}>();

const emit = defineEmits<{
  setModelMode: [mode: ShortAgentSubagentModelMode];
  setModelId: [modelId: string];
  setThinkingLevel: [level: string];
  setTemperature: [temperature: number];
  done: [];
}>();

// Run mode, web search, draws and model are rarely touched, so they stay folded away
// until asked for; the summary keeps the current choices visible.
const advancedOpen = ref(false);
const advancedPanelId = `subagent-advanced-${useId()}`;
const advancedSummary = computed(() => {
  const parts: string[] = [SUBAGENT_AGENT_MODE_LABELS[agentMode.value]];
  if (
    agentMode.value !== "pure-bare" &&
    webSearchMode.value &&
    webSearchMode.value !== "inherit"
  ) {
    parts.push(
      t("webSearchSummary", {
        arg0: SUBAGENT_WEB_SEARCH_LABELS[webSearchMode.value]
      })
    );
  }
  if (agentMode.value !== "standard" && draw.value?.enabled) {
    parts.push(t("drawSummary", { arg0: draw.value.count }));
  }
  if (props.subagent.modelMode === "custom") {
    const model = props.modelOptions.find(
      (option) => option.value === props.subagent.modelId
    );
    parts.push(model?.label ?? t("customModel"));
  } else {
    parts.push(t("primaryAgentModel"));
  }
  return parts.join(" · ");
});
</script>

<template>
  <div class="subagent-editor">
    <section class="editor-group" :aria-label="t('basics')">
      <h4>{{ t("basics") }}</h4>
      <label class="form-field">
        <span>{{ t("name") }}</span>
        <input
          v-model="name"
          type="text"
          :maxlength="SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH"
          :disabled="disabled"
          :readonly="Boolean(readOnly)"
          :placeholder="t('forExampleContinuityReview')"
        />
      </label>
      <label class="form-field">
        <span>{{ t("capabilities") }}</span>
        <textarea
          v-model="description"
          class="description-input"
          :maxlength="SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH"
          :disabled="disabled"
          :readonly="Boolean(readOnly)"
          :placeholder="t('describeTheTasksItHandlesSoThePrimaryAgent')"
        />
      </label>
    </section>

    <section class="editor-group" :aria-label="t('systemPrompt')">
      <header>
        <h4>{{ t("systemPrompt") }}</h4>
        <span class="char-count"
          >{{ systemPrompt.length }} /
          {{ SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH }}</span
        >
      </header>
      <textarea
        v-model="systemPrompt"
        class="prompt-input"
        :aria-label="t('systemPrompt')"
        :maxlength="SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH"
        :disabled="disabled"
        :readonly="Boolean(readOnly)"
        spellcheck="false"
        :placeholder="t('defineTheSubagentSRoleMethodsAndHandoffRequirements')"
      />
    </section>

    <section
      class="editor-group advanced-group"
      :aria-label="t('advancedSettings')"
    >
      <button
        type="button"
        class="advanced-toggle"
        :aria-expanded="advancedOpen"
        :aria-controls="advancedPanelId"
        @click="advancedOpen = !advancedOpen"
      >
        <span class="advanced-title">{{ t("advancedSettings") }}</span>
        <span class="advanced-summary">{{ advancedSummary }}</span>
        <AppIcon
          class="advanced-chevron"
          :class="{ 'is-open': advancedOpen }"
          name="chevron"
          :size="14"
        />
      </button>
      <div v-if="advancedOpen" :id="advancedPanelId" class="advanced-body">
        <SubagentModeField
          v-model="agentMode"
          :name="`subagent-agent-mode-${subagent.id}`"
          :disabled="disabled || Boolean(readOnly)"
        />
        <SubagentWebSearchField
          v-model="webSearchMode"
          :name="`subagent-web-search-${subagent.id}`"
          :agent-mode="agentMode"
          :disabled="disabled || Boolean(readOnly)"
        />
        <SubagentDrawField
          v-model="draw"
          :name="`subagent-draw-${subagent.id}`"
          :agent-mode="agentMode"
          :disabled="disabled || Boolean(readOnly)"
          :model-config="modelConfig"
        />
        <SubagentModelField
          :name="`subagent-model-mode-${subagent.id}`"
          :model-mode="subagent.modelMode"
          :model-id="subagent.modelId"
          :thinking-level="subagent.thinkingLevel"
          :temperature="subagent.temperature"
          :model-options="modelOptions"
          :thinking-options="thinkingOptions"
          :temperature-options="temperatureOptions"
          :disabled="disabled || Boolean(readOnly)"
          @set-mode="emit('setModelMode', $event)"
          @set-model-id="emit('setModelId', $event)"
          @set-thinking-level="emit('setThinkingLevel', $event)"
          @set-temperature="emit('setTemperature', $event)"
        />
      </div>
    </section>

    <footer class="editor-footer">
      <span
        >ID：<code>{{ subagent.id }}</code></span
      >
      <button type="button" :disabled="disabled" @click="emit('done')">
        {{ readOnly ? t("collapse") : t("doneEditing") }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.subagent-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
.editor-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
}
.editor-group + .editor-group {
  border-top: 1px solid var(--theme-line-soft);
}
.editor-group > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.editor-group h4 {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.04em;
}
.advanced-group {
  padding: 0;
}
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: none;
  color: var(--text-tertiary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.advanced-toggle:hover {
  background: var(--surface-hover);
}
.advanced-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  outline-offset: -2px;
}
.advanced-title {
  flex: none;
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.04em;
}
.advanced-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 0.785714rem;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.advanced-chevron {
  flex: none;
  transition: transform 150ms ease;
}
.advanced-chevron.is-open {
  transform: rotate(90deg);
}
.advanced-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  padding: 4px 16px 18px;
}
.char-count {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
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
.form-field input,
.form-field textarea,
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.55;
  resize: vertical;
}
.form-field input {
  min-height: 38px;
  padding: 8px 10px;
}
.form-field textarea,
.prompt-input {
  padding: 9px 10px;
}
.description-input {
  min-height: 76px;
}
.prompt-input {
  min-height: 180px;
  font-family: var(--code-font);
  font-size: 0.892857rem;
}
.form-field input:focus,
.form-field textarea:focus,
.prompt-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.form-field input::placeholder,
.form-field textarea::placeholder,
.prompt-input::placeholder {
  color: var(--text-tertiary);
}
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--theme-line-soft);
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
.editor-footer code {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
.editor-footer button {
  flex: none;
  padding: 7px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.821429rem;
  font-weight: 600;
  cursor: pointer;
}
.editor-footer button:hover:not(:disabled) {
  background: var(--surface-hover);
}
.editor-footer button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
