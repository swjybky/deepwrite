<script setup lang="ts">
import {
  DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT,
  SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH,
  SUBAGENT_DRAW_MAX_COUNT,
  SUBAGENT_DRAW_MIN_COUNT,
  type SubagentAgentMode,
  type SubagentDrawSelection,
  type SubagentDrawSettings
} from "@deepwrite/contracts/renderer";
import { computed, watch } from "vue";
import { createScopedTranslator } from "../i18n";
import AgentTeamSegmented from "./AgentTeamSegmented.vue";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";
import SubagentModelField from "./SubagentModelField.vue";
import { newSubagentDraw } from "./agentTeamDrawDraft";
import type { SubagentModelConfig } from "./useSubagentModelConfig";

const t = createScopedTranslator("components.subagentDrawField");

const draw = defineModel<SubagentDrawSettings | undefined>({
  required: true
});
const props = defineProps<{
  name: string;
  agentMode: SubagentAgentMode;
  disabled: boolean;
  modelConfig: SubagentModelConfig;
}>();

const AUTO_COUNT = "auto";
const pure = computed(() => props.agentMode !== "standard");
const enabled = computed(() => pure.value && draw.value?.enabled === true);
const countOptions: PopupSelectOption[] = [
  {
    value: AUTO_COUNT,
    label: t("countAuto", { arg0: SUBAGENT_DRAW_MAX_COUNT })
  },
  ...Array.from(
    { length: SUBAGENT_DRAW_MAX_COUNT - SUBAGENT_DRAW_MIN_COUNT + 1 },
    (_, offset) => {
      const value = SUBAGENT_DRAW_MIN_COUNT + offset;
      return { value, label: t("countValue", { arg0: value }) };
    }
  )
];
const countValue = computed(() =>
  draw.value?.countMode === "auto"
    ? AUTO_COUNT
    : (draw.value?.count ?? SUBAGENT_DRAW_MIN_COUNT)
);
const enabledHint = computed(() => {
  if (!draw.value) return "";
  const evaluated = draw.value.selection === "auto";
  if (draw.value.countMode === "auto") {
    return t(
      evaluated ? "enabledHintAutoCountEvaluated" : "enabledHintAutoCount",
      { arg0: SUBAGENT_DRAW_MAX_COUNT }
    );
  }
  return t(evaluated ? "enabledHintAuto" : "enabledHint", {
    arg0: draw.value.count
  });
});
const selectionOptions = computed(() => [
  { value: "manual" as const, label: t("manual") },
  { value: "auto" as const, label: t("auto") }
]);
const evaluatorPrompt = computed(
  () => draw.value?.evaluator.prompt ?? DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT
);
const promptCustomized = computed(
  () =>
    draw.value?.evaluator.prompt !== undefined &&
    draw.value.evaluator.prompt.trim() !==
      DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT
);

// Draws only make sense without write tools: leaving the pure modes turns
// the switch off but keeps the rest of the settings for later.
watch(
  () => props.agentMode,
  (mode) => {
    if (mode === "standard" && draw.value?.enabled) draw.value.enabled = false;
  }
);

function setEnabled(value: boolean): void {
  if (props.disabled || !pure.value) return;
  if (draw.value) draw.value.enabled = value;
  else if (value) draw.value = newSubagentDraw();
}

// Auto keeps the fixed count, so switching back restores it.
function setCount(value: string | number): void {
  if (!draw.value || props.disabled) return;
  if (value === AUTO_COUNT) {
    draw.value.countMode = "auto";
    return;
  }
  delete draw.value.countMode;
  draw.value.count = Number(value);
}

function setSelection(value: SubagentDrawSelection): void {
  if (draw.value && !props.disabled) draw.value.selection = value;
}

function setPrompt(event: Event): void {
  if (!draw.value || props.disabled) return;
  draw.value.evaluator.prompt = (event.target as HTMLTextAreaElement).value;
}

function restoreDefaultPrompt(): void {
  if (!draw.value || props.disabled) return;
  delete draw.value.evaluator.prompt;
}
</script>

<template>
  <div class="draw-field">
    <span class="draw-field-label">{{ t("drawMode") }}</span>
    <AgentTeamSwitch
      class="draw-switch"
      :model-value="enabled"
      :disabled="disabled || !pure"
      :label="t('drawMode')"
      @update:model-value="setEnabled"
    />
    <p class="draw-hint">
      {{
        !pure
          ? t("onlyAvailableInPureModes")
          : enabled && draw
            ? enabledHint
            : t("drawHint")
      }}
    </p>

    <template v-if="enabled && draw">
      <div class="draw-settings">
        <div class="draw-setting">
          <span class="draw-field-label">{{ t("drawCount") }}</span>
          <PopupSelect
            class="draw-count"
            :model-value="countValue"
            :options="countOptions"
            :accessible-label="t('drawCount')"
            size="large"
            :disabled="disabled"
            :menu-min-width="220"
            :menu-z-index="1200"
            @update:model-value="setCount"
          />
        </div>
        <div class="draw-setting">
          <span class="draw-field-label">{{ t("selection") }}</span>
          <AgentTeamSegmented
            :model-value="draw.selection"
            :options="selectionOptions"
            :name="`${name}-selection`"
            :label="t('selection')"
            :disabled="disabled"
            @update:model-value="setSelection"
          />
        </div>
      </div>
      <p class="draw-hint">
        {{ draw.selection === "auto" ? t("autoHint") : t("manualHint") }}
      </p>

      <section
        v-if="draw.selection === 'auto'"
        class="draw-evaluator"
        :aria-label="t('evaluator')"
      >
        <span class="draw-evaluator-title">{{ t("evaluator") }}</span>
        <SubagentModelField
          :name="`${name}-evaluator-model`"
          :model-mode="draw.evaluator.modelMode"
          :model-id="draw.evaluator.modelId"
          :thinking-level="draw.evaluator.thinkingLevel"
          :temperature="draw.evaluator.temperature"
          :model-options="modelConfig.modelOptions.value"
          :thinking-options="modelConfig.thinkingOptionsFor(draw.evaluator)"
          :temperature-options="
            modelConfig.temperatureOptionsFor(draw.evaluator)
          "
          :disabled="disabled"
          @set-mode="modelConfig.setModelMode(draw.evaluator, $event)"
          @set-model-id="modelConfig.setModelId(draw.evaluator, $event)"
          @set-thinking-level="
            modelConfig.setThinkingLevel(draw.evaluator, $event)
          "
          @set-temperature="modelConfig.setTemperature(draw.evaluator, $event)"
        />
        <div class="draw-prompt-header">
          <span class="draw-field-label">{{ t("evaluationRules") }}</span>
          <span class="draw-prompt-tools">
            <button
              v-if="promptCustomized"
              type="button"
              class="draw-restore"
              :disabled="disabled"
              @click="restoreDefaultPrompt"
            >
              {{ t("restoreDefault") }}
            </button>
            <span class="draw-char-count"
              >{{ evaluatorPrompt.length }} /
              {{ SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH }}</span
            >
          </span>
        </div>
        <textarea
          class="draw-prompt"
          :value="evaluatorPrompt"
          :aria-label="t('evaluationRules')"
          :maxlength="SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH"
          :disabled="disabled"
          spellcheck="false"
          @input="setPrompt"
        />
        <p class="draw-hint">{{ t("evaluatorBoundaryHint") }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.draw-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
.draw-switch {
  justify-self: start;
  margin: 2px 0;
}
.draw-field-label {
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 620;
}
.draw-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  line-height: 1.5;
}
.draw-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin-top: 6px;
}
.draw-setting {
  display: grid;
  justify-items: start;
  gap: 6px;
}
/* rem, so the auto label still fits at larger UI font sizes. */
.draw-count {
  width: 16rem;
  max-width: 100%;
}
.draw-evaluator {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-top: 6px;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.draw-evaluator-title {
  color: var(--text-primary);
  font-size: 0.857143rem;
  font-weight: 650;
}
.draw-prompt-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
}
.draw-prompt-tools {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
}
.draw-restore {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.785714rem;
  cursor: pointer;
}
.draw-restore:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.draw-char-count {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.draw-prompt {
  width: 100%;
  min-height: 150px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.857143rem;
  line-height: 1.55;
  resize: vertical;
}
.draw-prompt:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
</style>
