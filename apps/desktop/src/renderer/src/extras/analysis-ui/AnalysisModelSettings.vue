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
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { thinkingLabel } from "../../components/modelSettingsDraft";
import { createScopedTranslator } from "../../i18n";
import { buildModelSelectOptions } from "../../utils/modelSelectOptions";
import "./analysis-model-settings.css";

const t = createScopedTranslator("extras");

const props = defineProps<{
  models: readonly ModelConfig[];
  modelId: string;
  thinkingLevel: ThinkingLevel;
  disabled?: boolean;
  /** Names this selection (e.g. reading vs. integration) in the panel. */
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
const modelControl = ref<InstanceType<typeof PopupSelect> | null>(null);
const thinkingControl = ref<InstanceType<typeof PopupSelect> | null>(null);
const position = ref({ top: "0px", left: "0px" });
const availableModels = computed(() =>
  props.models.filter((model) => model.enabled !== false)
);
const selectedModel = computed(() =>
  availableModels.value.find((model) => model.id === props.modelId)
);
const modelOptions = computed(() =>
  buildModelSelectOptions(availableModels.value)
);
const thinkingLevels = computed<ThinkingLevel[]>(() => [
  "off",
  ...(selectedModel.value?.reasoning
    ? selectedModel.value.thinkingLevelOptions
    : [])
]);
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
  position.value = {
    left: `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 8))}px`
  };
}
function close(returnFocus = false): void {
  modelControl.value?.closeMenu();
  thinkingControl.value?.closeMenu();
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}
async function toggle(): Promise<void> {
  if (open.value) return close();
  if (props.disabled) return;
  open.value = true;
  await nextTick();
  reposition();
  panel.value?.focus();
}
function belongsToPanel(target: Node): boolean {
  if (trigger.value?.contains(target) || panel.value?.contains(target))
    return true;
  return [...(panel.value?.querySelectorAll("[aria-controls]") ?? [])].some(
    (control) => {
      const id = control.getAttribute("aria-controls");
      return id && document.getElementById(id)?.contains(target);
    }
  );
}
function outside(event: Event): void {
  if (
    open.value &&
    event.target instanceof Node &&
    !belongsToPanel(event.target)
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
      <AppIcon name="settings" :size="16" />
      <span v-if="field" class="analysis-model-summary">{{ summary }}</span>
      <template v-else>{{ t("analysisUi.modelSettings") }}</template>
    </button>
    <Teleport to="body">
      <section
        v-if="open"
        :id="panelId"
        ref="panel"
        class="analysis-model-panel"
        :style="position"
        role="dialog"
        tabindex="-1"
        :aria-labelledby="`${panelId}-title`"
      >
        <header>
          <strong :id="`${panelId}-title`">{{
            label ?? t("analysisUi.modelSettings")
          }}</strong>
          <button
            type="button"
            :aria-label="t('analysisUi.closeModelSettings')"
            @click="close(true)"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <label>
          <span>{{
            label
              ? t("analysisUi.modelField")
              : t("longBookAnalysis.analysisModel")
          }}</span>
          <PopupSelect
            ref="modelControl"
            :model-value="modelId"
            :options="modelOptions"
            :accessible-label="t('longBookAnalysis.analysisModel')"
            :placeholder="t('longBookAnalysis.modelNotConfigured')"
            :disabled="disabled || !modelOptions.length"
            @update:model-value="selectModel"
          />
        </label>
        <label>
          <span>{{ t("longBookAnalysis.thinkingLevel") }}</span>
          <PopupSelect
            ref="thinkingControl"
            :model-value="thinkingLevel"
            :options="thinkingOptions"
            :accessible-label="t('longBookAnalysis.thinkingLevel')"
            :disabled="disabled || !selectedModel"
            @update:model-value="selectThinking"
          />
        </label>
      </section>
    </Teleport>
  </div>
</template>
