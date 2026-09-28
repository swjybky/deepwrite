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
import type { ModelConfig } from "@deepwrite/contracts";
import { useContextWindowUsage } from "../composables/useContextWindowUsage";
import type { ChatMessage } from "../types/conversation";
import {
  formatContextPercentage,
  formatContextTokens
} from "../utils/contextWindowUsage";

const props = defineProps<{
  messages: ChatMessage[];
  model: ModelConfig | undefined;
}>();

const trigger = ref<HTMLButtonElement>();
const tooltip = ref<HTMLElement>();
const hovered = ref(false);
const focused = ref(false);
const tooltipPosition = ref<{
  left: string;
  top: string;
  visibility: "hidden" | "visible";
}>({ left: "0px", top: "0px", visibility: "hidden" });
const tooltipId = `context-window-tooltip-${useId()}`;
const tooltipOpen = computed(() => hovered.value || focused.value);
const { capacityStatus, contextWindow, measurement, usedTokens } =
  useContextWindowUsage({
    messages: () => props.messages,
    selectedModel: () => props.model
  });

const usedPercentageLabel = computed(() =>
  measurement.value
    ? formatContextPercentage(measurement.value.usedPercentage)
    : undefined
);
const remainingPercentageLabel = computed(() =>
  measurement.value
    ? formatContextPercentage(measurement.value.remainingPercentage)
    : undefined
);
const tokenRatioLabel = computed(() =>
  measurement.value
    ? `${formatContextTokens(measurement.value.usedTokens)} / ${formatContextTokens(
        measurement.value.contextWindow
      )} tokens`
    : undefined
);
const unavailableDetail = computed(() => {
  if (usedTokens.value !== undefined) {
    return `已记录 ${formatContextTokens(usedTokens.value)} tokens`;
  }
  if (contextWindow.value !== undefined) {
    return `最大上下文：${formatContextTokens(contextWindow.value)} tokens`;
  }
  return undefined;
});
const statusLabel = computed(() => {
  if (!props.model) return "尚未选择模型";
  if (capacityStatus.value === "resolving") return "正在读取上下文上限…";
  if (capacityStatus.value === "unavailable") return "上下文上限不可用";
  if (!measurement.value) return "等待实际用量";
  return `已使用 ${usedPercentageLabel.value}（剩余 ${remainingPercentageLabel.value}）`;
});
const accessibleLabel = computed(() => {
  const modelLabel = props.model?.label ?? "当前模型";
  const detail = tokenRatioLabel.value ?? unavailableDetail.value;
  return [modelLabel, statusLabel.value, detail].filter(Boolean).join("，");
});
const visualState = computed(() => {
  if (capacityStatus.value === "resolving") return "resolving";
  if (!measurement.value) return "unmeasured";
  const used = measurement.value.usedPercentage;
  // Three steps, so the chip escalates before the window is actually gone:
  // amber once compaction is near, red at the point the next send may overflow.
  if (used >= 90) return "over-limit";
  if (used >= 60) return "warning";
  return "measured";
});

async function updateTooltipPosition(): Promise<void> {
  if (!tooltipOpen.value) return;
  await nextTick();
  const triggerElement = trigger.value;
  const tooltipElement = tooltip.value;
  if (!triggerElement || !tooltipElement) return;

  const triggerRect = triggerElement.getBoundingClientRect();
  const margin = 8;
  const gap = 8;
  const width = tooltipElement.offsetWidth;
  const height = tooltipElement.offsetHeight;
  const left = Math.min(
    Math.max(margin, triggerRect.left + triggerRect.width / 2 - width / 2),
    Math.max(margin, window.innerWidth - width - margin)
  );
  const preferredTop = triggerRect.top - height - gap;
  const top =
    preferredTop >= margin
      ? preferredTop
      : Math.min(
          triggerRect.bottom + gap,
          Math.max(margin, window.innerHeight - height - margin)
        );
  tooltipPosition.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    visibility: "visible"
  };
}

function closeTooltip(): void {
  hovered.value = false;
  focused.value = false;
  trigger.value?.blur();
}

function handleViewportChange(): void {
  if (tooltipOpen.value) void updateTooltipPosition();
}

watch(
  () => [
    tooltipOpen.value,
    capacityStatus.value,
    contextWindow.value,
    usedTokens.value
  ],
  () => {
    if (!tooltipOpen.value) {
      tooltipPosition.value.visibility = "hidden";
      return;
    }
    void updateTooltipPosition();
  }
);

onMounted(() => {
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});
</script>

<template>
  <!--
    Laid out as a full-width strip under the composer rather than a chip in the
    toolbar: how full the context is decides whether the next send overflows, so
    it gets its own line instead of competing with the buttons.
  -->
  <span class="context-window-indicator" :data-state="visualState">
    <button
      ref="trigger"
      class="context-window-indicator-trigger"
      type="button"
      :aria-label="accessibleLabel"
      :aria-describedby="tooltipOpen ? tooltipId : undefined"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.esc.prevent="closeTooltip"
    >
      <span class="context-window-indicator-label">上下文</span>
      <span class="context-window-indicator-track" aria-hidden="true">
        <span
          class="context-window-indicator-fill"
          :style="{ width: `${Math.min(100, measurement?.usedPercentage ?? 0)}%` }"
        ></span>
      </span>
      <span class="context-window-indicator-value">
        {{ tokenRatioLabel ?? statusLabel }}
      </span>
    </button>

    <Teleport to="body">
      <section
        v-if="tooltipOpen"
        :id="tooltipId"
        ref="tooltip"
        class="context-window-tooltip"
        role="tooltip"
        :style="tooltipPosition"
      >
        <strong>{{ model?.label ?? "上下文窗口" }}</strong>
        <span>{{ statusLabel }}</span>
        <small v-if="tokenRatioLabel">{{ tokenRatioLabel }}</small>
        <small v-else-if="unavailableDetail">{{ unavailableDetail }}</small>
      </section>
    </Teleport>
  </span>
</template>
