<script setup lang="ts">
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, watch } from "vue";
import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
  MODEL_CONTEXT_WINDOW_MAX,
  MODEL_CONTEXT_WINDOW_MIN,
  MODEL_MAX_TOKENS_MAX,
  MODEL_MAX_TOKENS_MIN
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import { toModelInput, type DraftModel } from "./modelSettingsDraft";

const t = createScopedTranslator("components.modelAdvancedConfigDialog");

const props = defineProps<{
  model: DraftModel | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [
    capacity: {
      contextWindow: number;
      maxTokens: number;
      supportsDeveloperRole?: boolean;
    }
  ];
}>();

const firstInput = ref<HTMLInputElement | null>(null);
const contextWindowText = ref("");
const maxTokensText = ref("");
const disableDeveloperRole = ref(false);
const resolving = ref(false);
let resolveSequence = 0;

function hasCapacity(
  model: DraftModel
): model is DraftModel & { contextWindow: number; maxTokens: number } {
  return model.contextWindow !== undefined && model.maxTokens !== undefined;
}

function hydrate(contextWindow: number, maxTokens: number): void {
  contextWindowText.value = String(contextWindow);
  maxTokensText.value = String(maxTokens);
}

async function fillFromRuntime(model: DraftModel): Promise<void> {
  const sequence = ++resolveSequence;
  resolving.value = true;
  contextWindowText.value = "";
  maxTokensText.value = "";
  if (!model.modelId.trim()) {
    hydrate(
      DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
      DEFAULT_CUSTOM_MODEL_MAX_TOKENS
    );
    resolving.value = false;
    void nextTick(() => firstInput.value?.focus());
    return;
  }
  if (!window.deepwrite) {
    resolving.value = false;
    uiMessage.error(t("thisEnvironmentCannotReadTheModelSActualRequest"));
    return;
  }
  try {
    const result = await window.deepwrite.models.resolveCapacity(
      toModelInput({
        ...model,
        contextWindow: undefined,
        maxTokens: undefined
      })
    );
    if (sequence !== resolveSequence || !props.model) return;
    hydrate(result.contextWindow, result.maxTokens);
    void nextTick(() => firstInput.value?.focus());
  } catch (error: unknown) {
    if (sequence !== resolveSequence) return;
    uiMessage.error(
      formatError(error, t("couldNotReadTheModelSActualRequestCapacity"))
    );
  } finally {
    if (sequence === resolveSequence) resolving.value = false;
  }
}

watch(
  () => props.model,
  (model) => {
    resolveSequence += 1;
    resolving.value = false;
    disableDeveloperRole.value = model?.supportsDeveloperRole === false;
    if (!model) {
      contextWindowText.value = "";
      maxTokensText.value = "";
      return;
    }
    if (hasCapacity(model)) {
      hydrate(model.contextWindow, model.maxTokens);
      void nextTick(() => firstInput.value?.focus());
      return;
    }
    void fillFromRuntime(model);
  },
  { immediate: true }
);

function close(): void {
  if (!props.busy) emit("close");
}

function parseTokenCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isInteger(value) ? value : null;
}

function save(): void {
  if (props.busy || resolving.value || !props.model) return;
  const contextWindow = parseTokenCount(contextWindowText.value);
  const maxTokens = parseTokenCount(maxTokensText.value);
  if (
    contextWindow === null ||
    contextWindow < MODEL_CONTEXT_WINDOW_MIN ||
    contextWindow > MODEL_CONTEXT_WINDOW_MAX
  ) {
    uiMessage.warning(
      t("enterAContextLengthBetweenValueAndValue", {
        arg0: MODEL_CONTEXT_WINDOW_MIN,
        arg1: MODEL_CONTEXT_WINDOW_MAX
      })
    );
    return;
  }
  if (
    maxTokens === null ||
    maxTokens < MODEL_MAX_TOKENS_MIN ||
    maxTokens > MODEL_MAX_TOKENS_MAX
  ) {
    uiMessage.warning(
      t("enterAMaximumOutputLengthBetweenValueAndValue", {
        arg0: MODEL_MAX_TOKENS_MIN,
        arg1: MODEL_MAX_TOKENS_MAX
      })
    );
    return;
  }
  if (maxTokens > contextWindow) {
    uiMessage.warning(t("maximumOutputLengthCannotExceedContextLength"));
    return;
  }
  const supportsDeveloperRole = disableDeveloperRole.value
    ? false
    : props.model.supportsDeveloperRole === true
      ? true
      : undefined;
  emit("save", {
    contextWindow,
    maxTokens,
    ...(supportsDeveloperRole !== undefined ? { supportsDeveloperRole } : {})
  });
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="model"
      class="dialog-backdrop model-fetch-hint-overlay"
      @mousedown.self="close"
      @keydown.esc.stop="close"
    >
      <section
        class="model-fetch-hint-dialog model-advanced-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-advanced-config-title"
        tabindex="-1"
        @keydown.esc.stop="close"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ t("modelSettings") }}</span>
            <h2 id="model-advanced-config-title">
              {{ t("advancedSettings") }}
            </h2>
          </div>
        </header>
        <div class="model-advanced-config-fields">
          <label>
            <span>{{ t("contextLength") }}</span>
            <input
              ref="firstInput"
              v-model="contextWindowText"
              type="text"
              inputmode="numeric"
              :disabled="resolving"
              :placeholder="resolving ? t('readingActualRequestCapacity') : ''"
              :aria-label="t('contextLength')"
            />
          </label>
          <label>
            <span>{{ t("maximumOutputLength") }}</span>
            <input
              v-model="maxTokensText"
              type="text"
              inputmode="numeric"
              :disabled="resolving"
              :placeholder="resolving ? t('readingActualRequestCapacity') : ''"
              :aria-label="t('maximumOutputLength')"
            />
          </label>
          <label class="model-advanced-config-switch-row">
            <span class="model-advanced-config-switch-title">{{
              t("devRoleOff")
            }}</span>
            <AgentTeamSwitch
              v-model="disableDeveloperRole"
              :disabled="busy"
              :label="t('devRoleOff')"
            />
          </label>
        </div>
        <footer class="dialog-actions">
          <button
            class="dialog-secondary-button"
            type="button"
            :disabled="busy"
            @click="close"
          >
            {{ t("cancel") }}
          </button>
          <button
            class="dialog-primary-button"
            type="button"
            :disabled="busy || resolving"
            @click="save"
          >
            {{ busy ? t("saving") : t("save") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.model-advanced-config-fields {
  display: grid;
  gap: 12px;
  padding: 14px 18px 0;
}

.model-advanced-config-fields > label:not(.model-advanced-config-switch-row) {
  display: grid;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 0.678571rem;
}

.model-advanced-config-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-main);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.model-advanced-config-switch-row:hover {
  background: color-mix(in srgb, var(--surface-muted) 55%, var(--surface-main));
}

.model-advanced-config-switch-title {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 550;
  line-height: 1.4;
}

.model-advanced-config-fields input[type="text"] {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-variant-numeric: tabular-nums;
}

.model-advanced-config-fields input[type="text"]:focus {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--theme-line));
}
</style>
