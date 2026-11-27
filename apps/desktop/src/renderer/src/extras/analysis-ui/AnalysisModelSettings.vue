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
import type { ModelConfig, ThinkingLevel } from "@deepwrite/contracts/renderer";
import ModelPickerPanel from "../../components/ModelPickerPanel.vue";
import ModelProviderIcon from "../../components/ModelProviderIcon.vue";
import { thinkingLabel } from "../../components/modelSettingsDraft";
import { createScopedTranslator } from "../../i18n";
import {
  buildModelSelectOptions,
  modelThinkingLevels,
  resolveModelPickerSize
} from "../../utils/modelSelectOptions";
import { isTargetInPanel } from "../../utils/panelFocus";
import "./analysis-model-settings.css";

const t = createScopedTranslator("extras");

const props = defineProps<{
  models: readonly ModelConfig[];
  modelId: string;
  thinkingLevel: ThinkingLevel;
  disabled?: boolean;
  /** Accessible name for this selection (e.g. reading vs. integration). */
  label?: string;
  /** Show the chosen model and thinking level in the trigger like a field. */
  field?: boolean;
}>();
const emit = defineEmits<{
  "update:modelId": [value: string];
  "update:thinkingLevel": [value: ThinkingLevel];
}>();
const panelId = useId();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const position = ref<{ top: string; left: string; maxHeight?: string }>({
  top: "0px",
  left: "0px"
});
const availableModels = computed(() =>
  props.models.filter((model) => model.enabled !== false)
);
const selectedModel = computed(() =>
  availableModels.value.find((model) => model.id === props.modelId)
);
const modelOptions = computed(() =>
  buildModelSelectOptions(availableModels.value)
);
const thinkingLevels = computed(() => modelThinkingLevels(selectedModel.value));
const thinkingOptions = computed(() =>
  thinkingLevels.value.map((value) => ({ value, label: thinkingLabel(value) }))
);
const summary = computed(() =>
  t("longBookAnalysis.modelThinkingSummary", {
    model:
      selectedModel.value?.label ?? t("longBookAnalysis.modelNotConfigured"),
    thinking: thinkingLabel(props.thinkingLevel)
  })
);

function reposition(): void {
  if (!open.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const bounds = panel.value.getBoundingClientRect();
  const viewportMargin = 8;
  const gap = 8;
  const spaceBelow = Math.max(
    0,
    window.innerHeight - anchor.bottom - gap - viewportMargin
  );
  const spaceAbove = Math.max(0, anchor.top - gap - viewportMargin);
  const preferred = resolveModelPickerSize({
    hasRightPane: thinkingOptions.value.length > 0
  });
  const opensUpward = spaceBelow < preferred.height && spaceAbove > spaceBelow;
  const availableHeight = Math.max(180, opensUpward ? spaceAbove : spaceBelow);
  const maxPanelHeight = Math.min(preferred.height, availableHeight);
  const renderedHeight = Math.min(
    bounds.height || maxPanelHeight,
    maxPanelHeight
  );
  const preferredLeft = props.field ? anchor.left : anchor.right - bounds.width;
  const left = Math.max(
    viewportMargin,
    Math.min(preferredLeft, window.innerWidth - bounds.width - viewportMargin)
  );
  const top = opensUpward
    ? Math.max(viewportMargin, anchor.top - gap - renderedHeight)
    : Math.max(
        viewportMargin,
        Math.min(
          anchor.bottom + gap,
          window.innerHeight - renderedHeight - viewportMargin
        )
      );
  position.value = {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${maxPanelHeight}px`
  };
}
function close(returnFocus = false): void {
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}
async function toggle(): Promise<void> {
  if (open.value) return close();
  if (props.disabled) return;
  open.value = true;
  await nextTick();
  reposition();
  if (!panel.value?.contains(document.activeElement)) {
    panel.value?.focus();
  }
}
function outside(event: Event): void {
  if (
    open.value &&
    event.target instanceof Node &&
    !isTargetInPanel(event.target, trigger.value, panel.value)
  )
    close();
}
function onKeydown(event: KeyboardEvent): void {
  if (open.value && event.key === "Escape" && !event.defaultPrevented) {
    event.preventDefault();
    close(true);
  }
}
function selectModel(value: string | number): void {
  if (
    !props.disabled &&
    availableModels.value.some((model) => model.id === value)
  )
    emit("update:modelId", String(value));
}
function selectThinking(value: string | number): void {
  const level = thinkingLevels.value.find((candidate) => candidate === value);
  if (!props.disabled && level) emit("update:thinkingLevel", level);
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
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
  <div class="analysis-model-settings" :class="{ 'is-field': field }">
    <button
      ref="trigger"
      type="button"
      class="analysis-model-trigger"
      :title="summary"
      :aria-label="label ?? t('analysisUi.modelSettings')"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="toggle"
    >
      <ModelProviderIcon
        :provider="selectedModel?.provider"
        :model-id="selectedModel?.modelId"
        :label="selectedModel?.label"
        :size="15"
      />
      <span v-if="field" class="analysis-model-summary">{{ summary }}</span>
      <template v-else>{{ t("analysisUi.modelSettings") }}</template>
    </button>
    <Teleport to="body">
      <section
        v-if="open"
        :id="panelId"
        ref="panel"
        class="analysis-model-panel is-picker-panel"
        :style="position"
        role="dialog"
        tabindex="-1"
        :aria-label="label ?? t('analysisUi.modelSettings')"
      >
        <ModelPickerPanel
          :active="open"
          :selected-model-id="modelId"
          :model-options="modelOptions"
          :thinking-level="thinkingLevel"
          :thinking-options="thinkingOptions"
          hides-web-search
          :placeholder="t('longBookAnalysis.modelNotConfigured')"
          @select-model="selectModel"
          @select-thinking="selectThinking"
        />
      </section>
    </Teleport>
  </div>
</template>
