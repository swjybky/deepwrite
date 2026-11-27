<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch
} from "vue";
import {
  DECOMPOSITION_MAX_FALLBACK_MODELS,
  type DecompositionModelSelection,
  type ModelConfig,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import ConversationModelConfigSelect from "../../components/ConversationModelConfigSelect.vue";
import { thinkingLabel } from "../../components/modelSettingsDraft";
import { createScopedTranslator } from "../../i18n";
import {
  buildModelSelectOptions,
  modelThinkingLevels
} from "../../utils/modelSelectOptions";
import { isTargetInPanel } from "../../utils/panelFocus";
import "../analysis-ui/analysis-model-settings.css";
import "./decomposition-models.css";

const t = createScopedTranslator("extras.longBookDecomposition");
const tRoot = createScopedTranslator("extras");

const props = withDefaults(
  defineProps<{
    models: readonly ModelConfig[];
    modelId: string;
    thinkingLevel: ThinkingLevel;
    fallbacks: readonly DecompositionModelSelection[];
    label: string;
    disabled?: boolean;
    confirmSave?: boolean;
    saving?: boolean;
  }>(),
  {
    disabled: false,
    confirmSave: false,
    saving: false
  }
);
const emit = defineEmits<{
  "update:modelId": [value: string];
  "update:thinkingLevel": [value: ThinkingLevel];
  "update:fallbacks": [value: DecompositionModelSelection[]];
  save: [
    payload: {
      primary: DecompositionModelSelection;
      fallbacks: DecompositionModelSelection[];
    }
  ];
}>();

const panelId = useId();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const position = ref({ top: "0px", left: "0px" });

const draftPrimary = ref<DecompositionModelSelection>({
  modelId: props.modelId,
  thinkingLevel: props.thinkingLevel
});
const draftFallbacks = ref<DecompositionModelSelection[]>(
  props.fallbacks.map((item) => ({ ...item }))
);

function resetDraft(): void {
  draftPrimary.value = {
    modelId: props.modelId,
    thinkingLevel: props.thinkingLevel
  };
  draftFallbacks.value = props.fallbacks.map((item) => ({ ...item }));
}

const activePrimary = computed(() =>
  props.confirmSave
    ? draftPrimary.value
    : { modelId: props.modelId, thinkingLevel: props.thinkingLevel }
);
const activeFallbacks = computed(() =>
  props.confirmSave ? draftFallbacks.value : props.fallbacks
);

const availableModels = computed(() =>
  props.models.filter((model) => model.enabled !== false)
);
const findModel = (id: string) =>
  availableModels.value.find((model) => model.id === id);

const selectedPrimaryModel = computed(() =>
  findModel(activePrimary.value.modelId)
);
const triggerPrimaryModel = computed(() => findModel(props.modelId));

const primaryModelOptions = computed(() =>
  buildModelSelectOptions(availableModels.value)
);

function thinkingOptionsFor(modelId: string) {
  return modelThinkingLevels(findModel(modelId)).map((value) => ({
    value,
    label: thinkingLabel(value)
  }));
}

function fallbackModelOptions(index: number) {
  const taken = new Set<string>([activePrimary.value.modelId]);
  activeFallbacks.value.forEach((item, idx) => {
    if (idx !== index) taken.add(item.modelId);
  });
  return buildModelSelectOptions(
    availableModels.value.filter((model) => !taken.has(model.id))
  );
}

const nextAddableModel = computed(() => {
  const taken = new Set<string>([
    activePrimary.value.modelId,
    ...activeFallbacks.value.map((item) => item.modelId)
  ]);
  return availableModels.value.find((model) => !taken.has(model.id));
});

const canAddFallback = computed(
  () =>
    !props.disabled &&
    !props.saving &&
    Boolean(nextAddableModel.value) &&
    activeFallbacks.value.length < DECOMPOSITION_MAX_FALLBACK_MODELS
);

const dirty = computed(() => {
  if (!props.confirmSave) return false;
  if (
    draftPrimary.value.modelId !== props.modelId ||
    draftPrimary.value.thinkingLevel !== props.thinkingLevel ||
    draftFallbacks.value.length !== props.fallbacks.length
  )
    return true;
  return draftFallbacks.value.some(
    (item, index) =>
      item.modelId !== props.fallbacks[index]?.modelId ||
      item.thinkingLevel !== props.fallbacks[index]?.thinkingLevel
  );
});

const draftValid = computed(
  () =>
    Boolean(draftPrimary.value.modelId) &&
    Boolean(findModel(draftPrimary.value.modelId)) &&
    draftFallbacks.value.every((item) => Boolean(findModel(item.modelId)))
);

const triggerSummary = computed(() => {
  const modelName =
    triggerPrimaryModel.value?.label ??
    (props.modelId
      ? t("modelUnavailable", { id: props.modelId })
      : tRoot("longBookAnalysis.modelNotConfigured"));
  return tRoot("longBookAnalysis.modelThinkingSummary", {
    model: modelName,
    thinking: thinkingLabel(props.thinkingLevel)
  });
});

const triggerTitle = computed(() =>
  props.fallbacks.length
    ? `${triggerSummary.value} (${t("fallbackBadge", { count: props.fallbacks.length })})`
    : triggerSummary.value
);

function commitPrimary(next: DecompositionModelSelection): void {
  if (props.confirmSave) {
    draftPrimary.value = next;
    return;
  }
  if (next.modelId !== props.modelId) emit("update:modelId", next.modelId);
  if (next.thinkingLevel !== props.thinkingLevel)
    emit("update:thinkingLevel", next.thinkingLevel);
}

function commitFallbacks(next: DecompositionModelSelection[]): void {
  if (props.confirmSave) {
    draftFallbacks.value = next;
    return;
  }
  emit("update:fallbacks", next);
}

function selectPrimaryModel(value: string | number): void {
  const id = String(value);
  const chosen = findModel(id);
  if (props.disabled || props.saving || !chosen) return;
  const levels = modelThinkingLevels(chosen);
  const nextThinking = levels.includes(activePrimary.value.thinkingLevel)
    ? activePrimary.value.thinkingLevel
    : chosen.defaultThinkingLevel;
  const nextFallbacks = activeFallbacks.value
    .filter((item) => item.modelId !== id)
    .map((item) => ({ ...item }));
  commitPrimary({ modelId: id, thinkingLevel: nextThinking });
  if (nextFallbacks.length !== activeFallbacks.value.length)
    commitFallbacks(nextFallbacks);
}

function selectPrimaryThinking(value: string | number): void {
  const level = modelThinkingLevels(selectedPrimaryModel.value).find(
    (candidate) => candidate === value
  );
  if (!props.disabled && !props.saving && level)
    commitPrimary({
      modelId: activePrimary.value.modelId,
      thinkingLevel: level
    });
}

function addFallback(): void {
  const candidate = nextAddableModel.value;
  if (!candidate || !canAddFallback.value) return;
  commitFallbacks([
    ...activeFallbacks.value.map((item) => ({ ...item })),
    {
      modelId: candidate.id,
      thinkingLevel: candidate.defaultThinkingLevel
    }
  ]);
}

function selectFallbackModel(index: number, value: string | number): void {
  const id = String(value);
  const chosen = findModel(id);
  const current = activeFallbacks.value[index];
  if (props.disabled || props.saving || !chosen || !current) return;
  const levels = modelThinkingLevels(chosen);
  const nextThinking = levels.includes(current.thinkingLevel)
    ? current.thinkingLevel
    : chosen.defaultThinkingLevel;
  commitFallbacks(
    activeFallbacks.value.map((item, idx) =>
      idx === index ? { modelId: id, thinkingLevel: nextThinking } : { ...item }
    )
  );
}

function selectFallbackThinking(index: number, value: string | number): void {
  const current = activeFallbacks.value[index];
  if (props.disabled || props.saving || !current) return;
  const level = modelThinkingLevels(findModel(current.modelId)).find(
    (candidate) => candidate === value
  );
  if (!level) return;
  commitFallbacks(
    activeFallbacks.value.map((item, idx) =>
      idx === index ? { ...item, thinkingLevel: level } : { ...item }
    )
  );
}

function moveFallback(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (
    props.disabled ||
    props.saving ||
    target < 0 ||
    target >= activeFallbacks.value.length
  )
    return;
  const next = activeFallbacks.value.map((item) => ({ ...item }));
  const [moved] = next.splice(index, 1);
  if (!moved) return;
  next.splice(target, 0, moved);
  commitFallbacks(next);
}

function removeFallback(index: number): void {
  if (props.disabled || props.saving) return;
  commitFallbacks(
    activeFallbacks.value
      .filter((_, idx) => idx !== index)
      .map((item) => ({ ...item }))
  );
}

function submitSave(): void {
  if (!props.confirmSave || !dirty.value || !draftValid.value || props.saving)
    return;
  emit("save", {
    primary: { ...draftPrimary.value },
    fallbacks: draftFallbacks.value.map((item) => ({ ...item }))
  });
}

function reposition(): void {
  if (!open.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const bounds = panel.value.getBoundingClientRect();
  position.value = {
    left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 8))}px`
  };
}

function close(returnFocus = false): void {
  panel.value?.querySelectorAll('[aria-expanded="true"]').forEach((control) => {
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}

async function toggle(): Promise<void> {
  if (open.value) return close();
  if (props.disabled) return;
  resetDraft();
  open.value = true;
  await nextTick();
  reposition();
  panel.value?.focus();
}

function outside(event: Event): void {
  if (
    open.value &&
    !props.saving &&
    event.target instanceof Node &&
    !isTargetInPanel(event.target, trigger.value, panel.value)
  )
    close();
}

function onKeydown(event: KeyboardEvent): void {
  if (
    open.value &&
    !props.saving &&
    event.key === "Escape" &&
    !event.defaultPrevented
  ) {
    event.preventDefault();
    close(true);
  }
}

watch(
  [() => props.modelId, () => props.thinkingLevel, () => props.fallbacks],
  () => {
    if (!open.value) resetDraft();
  },
  { deep: true }
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && !props.saving) close();
  }
);
watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (wasSaving && !saving && open.value && !dirty.value) close(true);
  }
);

let resizeObserver: ResizeObserver | undefined;
watch(panel, (element) => {
  resizeObserver?.disconnect();
  if (element) {
    resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(element);
  }
});
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", reposition);
  document.addEventListener("scroll", reposition, true);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", reposition);
  document.removeEventListener("scroll", reposition, true);
});
</script>

<template>
  <div class="analysis-model-settings is-field decomposition-model-field">
    <button
      ref="trigger"
      type="button"
      class="analysis-model-trigger"
      :title="triggerTitle"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="toggle"
    >
      <AppIcon name="settings" :size="16" />
      <span class="analysis-model-summary">{{ triggerSummary }}</span>
      <span v-if="fallbacks.length" class="decomposition-model-fallback-count">
        {{ t("fallbackBadge", { count: fallbacks.length }) }}
      </span>
    </button>
    <Teleport to="body">
      <section
        v-if="open"
        :id="panelId"
        ref="panel"
        class="analysis-model-panel decomposition-model-panel"
        :style="position"
        role="dialog"
        tabindex="-1"
        :aria-labelledby="`${panelId}-title`"
      >
        <header>
          <strong :id="`${panelId}-title`">{{ label }}</strong>
          <button
            type="button"
            :aria-label="tRoot('analysisUi.closeModelSettings')"
            :disabled="saving"
            @click="close(true)"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="decomposition-model-section">
          <span class="decomposition-model-section-label">{{
            t("primaryModel")
          }}</span>
          <div class="decomposition-model-pair">
            <ConversationModelConfigSelect
              variant="field"
              hides-web-search
              :menu-z-index="1100"
              :selected-model-id="activePrimary.modelId"
              :model-options="primaryModelOptions"
              :thinking-level="activePrimary.thinkingLevel"
              :thinking-options="thinkingOptionsFor(activePrimary.modelId)"
              :accessible-label="t('primaryModel')"
              :placeholder="
                activePrimary.modelId && !selectedPrimaryModel
                  ? t('modelUnavailable', { id: activePrimary.modelId })
                  : tRoot('longBookAnalysis.modelNotConfigured')
              "
              :disabled="disabled || saving || !primaryModelOptions.length"
              @select-model="selectPrimaryModel"
              @select-thinking="selectPrimaryThinking"
            />
          </div>
        </div>
        <div class="decomposition-model-section">
          <div class="decomposition-fallback-header">
            <span class="decomposition-model-section-label">{{
              t("fallbackModels")
            }}</span>
            <button
              type="button"
              class="decomposition-fallback-add"
              :disabled="!canAddFallback"
              @click="addFallback"
            >
              <AppIcon name="plus" :size="14" />{{ t("addFallback") }}
            </button>
          </div>
          <p class="decomposition-model-hint">{{ t("fallbackModelsHint") }}</p>
          <div
            v-if="activeFallbacks.length"
            class="decomposition-fallback-list"
          >
            <div
              v-for="(item, index) in activeFallbacks"
              :key="`${index}:${item.modelId}`"
              class="decomposition-fallback-item"
            >
              <span class="decomposition-fallback-index">{{ index + 1 }}</span>
              <div class="decomposition-fallback-selects">
                <ConversationModelConfigSelect
                  variant="field"
                  hides-web-search
                  :menu-z-index="1100"
                  :selected-model-id="item.modelId"
                  :model-options="fallbackModelOptions(index)"
                  :thinking-level="item.thinkingLevel"
                  :thinking-options="thinkingOptionsFor(item.modelId)"
                  :accessible-label="t('fallbackOrder', { index: index + 1 })"
                  :placeholder="
                    findModel(item.modelId)
                      ? t('choose')
                      : t('modelUnavailable', { id: item.modelId })
                  "
                  :disabled="disabled || saving"
                  @select-model="selectFallbackModel(index, $event)"
                  @select-thinking="selectFallbackThinking(index, $event)"
                />
              </div>
              <div class="decomposition-fallback-actions">
                <button
                  type="button"
                  class="decomposition-fallback-icon-btn"
                  :aria-label="t('moveFallbackUp')"
                  :title="t('moveFallbackUp')"
                  :disabled="disabled || saving || index === 0"
                  @click="moveFallback(index, -1)"
                >
                  <AppIcon name="arrow-up" :size="14" />
                </button>
                <button
                  type="button"
                  class="decomposition-fallback-icon-btn"
                  :aria-label="t('moveFallbackDown')"
                  :title="t('moveFallbackDown')"
                  :disabled="
                    disabled || saving || index === activeFallbacks.length - 1
                  "
                  @click="moveFallback(index, 1)"
                >
                  <AppIcon name="arrow-up" :size="14" class="is-rotated" />
                </button>
                <button
                  type="button"
                  class="decomposition-fallback-icon-btn is-danger"
                  :aria-label="t('removeFallback')"
                  :title="t('removeFallback')"
                  :disabled="disabled || saving"
                  @click="removeFallback(index)"
                >
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </div>
          </div>
          <p v-else class="decomposition-fallback-empty">
            {{ t("fallbackEmpty") }}
          </p>
        </div>
        <footer v-if="confirmSave" class="decomposition-model-footer">
          <button
            type="button"
            class="dialog-secondary-button"
            :disabled="saving"
            @click="close(true)"
          >
            {{ t("cancel") }}
          </button>
          <button
            type="button"
            class="dialog-primary-button"
            :disabled="!dirty || !draftValid || saving"
            @click="submitSave"
          >
            {{ t("saveModels") }}
          </button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>
