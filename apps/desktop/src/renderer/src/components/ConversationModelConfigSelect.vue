<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots,
  watch,
  type CSSProperties
} from "vue";
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import AppIcon from "./AppIcon.vue";
import ModelPickerPanel from "./ModelPickerPanel.vue";
import ModelProviderIcon from "./ModelProviderIcon.vue";
import type { IconName } from "../types/workspace";
import type { PopupSelectOption } from "../types/popupSelect";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import { resolveModelPickerSize } from "../utils/modelSelectOptions";
import { isTargetInPanel } from "../utils/panelFocus";

const t = createScopedTranslator("components.conversationModelConfigSelect");

const props = withDefaults(
  defineProps<{
    selectedModelId: string;
    modelOptions: readonly (ModelSelectOption | PopupSelectOption)[];
    thinkingLevel?: ThinkingLevel;
    thinkingOptions?: ReadonlyArray<{ value: ThinkingLevel; label: string }>;
    temperature?: number;
    temperatureOptions?: ReadonlyArray<{ value: number; label: string }>;
    showsTemperature?: boolean;
    webSearchEnabled?: boolean;
    webSearchAvailable?: boolean;
    webSearchDisabledReason?: string;
    hidesWebSearch?: boolean;
    responding?: boolean;
    disabled?: boolean;
    variant?: "compact" | "field";
    align?: "start" | "end";
    menuZIndex?: number;
    placeholder?: string;
    accessibleLabel?: string;
    closeOnModelSelect?: boolean | null;
    teamModeActive?: boolean;
    teamModeLabel?: string;
    approvalModeIcon?: IconName | undefined;
    approvalModeLabel?: string;
  }>(),
  {
    thinkingLevel: "off",
    thinkingOptions: () => [],
    temperature: 0.7,
    temperatureOptions: () => [],
    showsTemperature: false,
    webSearchEnabled: false,
    webSearchAvailable: false,
    webSearchDisabledReason: "",
    hidesWebSearch: false,
    responding: false,
    disabled: false,
    variant: "compact",
    align: "start",
    menuZIndex: 1000,
    placeholder: "",
    accessibleLabel: "",
    closeOnModelSelect: null,
    teamModeActive: false,
    teamModeLabel: "",
    approvalModeLabel: ""
  }
);

const emit = defineEmits<{
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  toggleWebSearch: [enabled: boolean];
}>();

const slots = useSlots();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const menuStyle = ref<CSSProperties>({});
const menuId = createId("conversation-model-config");

const selectedOption = computed(() =>
  props.modelOptions.find(
    (option) => String(option.value) === props.selectedModelId
  )
);

const selectedProvider = computed(() => {
  const option = selectedOption.value;
  return option && "provider" in option ? option.provider : undefined;
});

const selectedModelAttr = computed(() => {
  const option = selectedOption.value;
  return option && "modelId" in option ? option.modelId : undefined;
});

const selectedModelLabel = computed(
  () => selectedOption.value?.label ?? (props.placeholder || t("selectModel"))
);

const thinkingLabel = computed(
  () =>
    props.thinkingOptions.find((option) => option.value === props.thinkingLevel)
      ?.label ?? t("off")
);

const temperatureLabel = computed(
  () =>
    props.temperatureOptions.find(
      (option) => option.value === props.temperature
    )?.label ?? String(props.temperature)
);

const hasParameterOptions = computed(
  () =>
    props.thinkingOptions.length > 0 ||
    (props.showsTemperature && props.temperatureOptions.length > 0)
);

const hasRightPane = computed(
  () => hasParameterOptions.value || !props.hidesWebSearch
);

const activeParameterLabel = computed(() => {
  if (!hasParameterOptions.value) return "";
  return props.showsTemperature
    ? t("temperatureValue", { arg0: temperatureLabel.value })
    : thinkingLabel.value;
});

const triggerTitle = computed(() =>
  [
    selectedModelLabel.value,
    activeParameterLabel.value,
    props.teamModeActive ? props.teamModeLabel : "",
    props.approvalModeLabel
  ]
    .filter(Boolean)
    .join(" · ")
);

const shouldCloseOnModelSelect = computed(
  () => props.closeOnModelSelect ?? !hasRightPane.value
);

function positionMenu(): void {
  if (!open.value || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const viewportMargin = 8;
  const gap = 6;
  const hasFooter = Boolean(slots.footer);
  const { width: preferredWidth, height: preferredHeight } =
    resolveModelPickerSize({
      hasRightPane: hasRightPane.value,
      hasFooter
    });
  const width = Math.min(
    preferredWidth,
    window.innerWidth - viewportMargin * 2
  );

  const spaceBelow = Math.max(
    0,
    window.innerHeight - rect.bottom - gap - viewportMargin
  );
  const spaceAbove = Math.max(0, rect.top - gap - viewportMargin);
  const opensUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableHeight = Math.max(180, opensUpward ? spaceAbove : spaceBelow);
  const renderedHeight = Math.min(preferredHeight, availableHeight);
  const preferredLeft = props.align === "end" ? rect.right - width : rect.left;
  const left = Math.min(
    Math.max(viewportMargin, preferredLeft),
    window.innerWidth - width - viewportMargin
  );
  const top = opensUpward ? rect.top - gap - renderedHeight : rect.bottom + gap;

  menuStyle.value = {
    top: `${Math.max(viewportMargin, top)}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${renderedHeight}px`,
    maxHeight: `${availableHeight}px`,
    zIndex: props.menuZIndex,
    transformOrigin: opensUpward ? "bottom" : "top"
  };
}

async function openMenu(): Promise<void> {
  if (props.disabled || open.value || props.modelOptions.length === 0) return;
  open.value = true;
  await nextTick();
  positionMenu();
}

function closeMenu(returnFocus = false): void {
  if (!open.value) return;
  menu.value?.querySelectorAll('[aria-expanded="true"]').forEach((control) => {
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}

function toggleMenu(): void {
  if (open.value) closeMenu();
  else void openMenu();
}

function handleSelectModel(modelId: string): void {
  emit("selectModel", modelId);
  if (shouldCloseOnModelSelect.value) {
    closeMenu(true);
  }
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    return;
  }
  if (["Enter", " ", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (!open.value) void openMenu();
  }
}

function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}

function handleDocumentPointerdown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Node &&
    !isTargetInPanel(target, trigger.value, menu.value)
  ) {
    closeMenu();
  }
}

function handleViewportChange(event: Event): void {
  if (
    event.target instanceof Node &&
    isTargetInPanel(event.target, trigger.value, menu.value)
  ) {
    return;
  }
  if (open.value) positionMenu();
}

watch(
  () =>
    [
      props.disabled,
      props.modelOptions.length,
      props.showsTemperature,
      hasRightPane.value
    ] as const,
  ([disabled, modelCount]) => {
    if (disabled || modelCount === 0) closeMenu();
    else if (open.value) void nextTick(positionMenu);
  }
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerdown);
  window.addEventListener("resize", handleViewportChange);
  document.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerdown);
  window.removeEventListener("resize", handleViewportChange);
  document.removeEventListener("scroll", handleViewportChange, true);
});

defineExpose({ openMenu, closeMenu, trigger, open });
</script>

<template>
  <span
    class="conversation-model-config"
    :class="[`is-${variant}`, { 'is-open': open, 'is-disabled': disabled }]"
  >
    <button
      ref="trigger"
      class="conversation-model-config-trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-label="accessibleLabel || t('modelSettings')"
      :title="triggerTitle"
      :aria-controls="open ? menuId : undefined"
      :aria-expanded="open"
      :disabled="disabled || modelOptions.length === 0"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span class="conversation-model-config-icons">
        <ModelProviderIcon
          :group-key="selectedOption?.group?.key"
          :provider="selectedProvider"
          :model-id="selectedModelAttr"
          :label="selectedOption?.label"
          :size="14"
        />
        <AppIcon
          v-if="webSearchEnabled && !hidesWebSearch"
          class="conversation-model-config-network-indicator"
          name="globe"
          :size="11"
        />
        <AppIcon
          v-if="teamModeActive"
          class="conversation-model-config-status-indicator"
          name="brain"
          :size="11"
        />
        <AppIcon
          v-if="approvalModeIcon === 'user'"
          class="conversation-model-config-status-indicator"
          name="user"
          :size="11"
        />
      </span>
      <span
        class="conversation-model-config-label"
        :class="{ 'is-placeholder': !selectedOption }"
        >{{ selectedModelLabel }}</span
      >
      <span
        v-if="activeParameterLabel"
        class="conversation-model-config-summary"
      >
        · {{ activeParameterLabel }}
      </span>
      <AppIcon
        class="conversation-model-config-chevron"
        name="chevron"
        :size="variant === 'field' ? 13 : 11"
      />
    </button>

    <Teleport to="body">
      <Transition name="conversation-model-config-menu">
        <section
          v-if="open"
          :id="menuId"
          ref="menu"
          class="conversation-model-config-menu"
          :style="menuStyle"
          role="dialog"
          :aria-label="accessibleLabel || t('modelSettings')"
          @keydown="handleMenuKeydown"
        >
          <ModelPickerPanel
            :active="open"
            :selected-model-id="selectedModelId"
            :model-options="modelOptions"
            :thinking-level="thinkingLevel"
            :thinking-options="thinkingOptions"
            :temperature="temperature"
            :temperature-options="temperatureOptions"
            :shows-temperature="showsTemperature"
            :web-search-enabled="webSearchEnabled"
            :web-search-available="webSearchAvailable"
            :web-search-disabled-reason="webSearchDisabledReason"
            :hides-web-search="hidesWebSearch"
            :responding="responding"
            :placeholder="placeholder"
            @select-model="handleSelectModel"
            @select-thinking="emit('selectThinking', $event)"
            @select-temperature="emit('selectTemperature', $event)"
            @toggle-web-search="emit('toggleWebSearch', $event)"
          >
            <template v-if="slots.footer" #footer>
              <slot name="footer" />
            </template>
          </ModelPickerPanel>
        </section>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped src="../styles/conversation-model-config-select.css"></style>
