<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, nextTick, onBeforeUnmount, ref, useId } from "vue";
import type { ConversationTurn } from "../composables/useConversationTurnNavigator";
import { useConversationTurnRail } from "../composables/useConversationTurnRail";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.conversationTurnNavigator");

const props = defineProps<{
  turns: readonly ConversationTurn[];
  activeTurnId: string | null;
}>();

const emit = defineEmits<{
  select: [messageId: string];
}>();

const {
  navigator,
  markerList,
  railStyle,
  availableHeight,
  hasOverflow,
  canScrollUp,
  canScrollDown,
  handleMarkerScroll,
  scrollPage,
  scrollMarkers
} = useConversationTurnRail({
  turns: () => props.turns,
  activeTurnId: () => props.activeTurnId,
  dismissPreview,
  onScroll: updatePreviewOnScroll
});
const previewId = useId();
const preview = ref<HTMLButtonElement>();
const hoveredTurnId = ref<string | null>(null);
const focusedTurnId = ref<string | null>(null);
const previewTop = ref(0);
let previewHideTimer: number | undefined;
const previewTurnId = computed(
  () => focusedTurnId.value ?? hoveredTurnId.value
);
const previewTurn = computed(() =>
  props.turns.find((turn) => turn.id === previewTurnId.value)
);
const compactPreview = computed(() => availableHeight.value < 224);

function positionPreview(target: HTMLElement): void {
  const container = navigator.value;
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetCenter =
    targetRect.top - containerRect.top + targetRect.height / 2;
  const surfaceRect =
    container.parentElement?.getBoundingClientRect() ?? containerRect;
  const halfHeight = (preview.value?.offsetHeight ?? 104) / 2;
  const minTop = surfaceRect.top - containerRect.top + halfHeight + 8;
  const maxTop = surfaceRect.bottom - containerRect.top - halfHeight - 8;
  previewTop.value = Math.min(Math.max(targetCenter, minTop), maxTop);
}

function showPreview(
  turnId: string,
  event: MouseEvent | FocusEvent,
  source: "hover" | "focus"
): void {
  cancelPreviewHide();
  if (source === "hover") hoveredTurnId.value = turnId;
  else focusedTurnId.value = turnId;
  const target = event.currentTarget as HTMLElement;
  positionPreview(target);
  void nextTick(() => {
    if (previewTurnId.value === turnId) positionPreview(target);
  });
}

function hidePreview(turnId: string, source: "hover" | "focus"): void {
  if (source === "hover" && hoveredTurnId.value === turnId) {
    hoveredTurnId.value = null;
  }
  if (source === "focus" && focusedTurnId.value === turnId) {
    focusedTurnId.value = null;
  }
}

function cancelPreviewHide(): void {
  if (previewHideTimer === undefined) return;
  globalThis.clearTimeout(previewHideTimer);
  previewHideTimer = undefined;
}

function schedulePreviewHide(turnId: string, source: "hover" | "focus"): void {
  cancelPreviewHide();
  previewHideTimer = globalThis.setTimeout(() => {
    previewHideTimer = undefined;
    hidePreview(turnId, source);
  }, 120);
}

function dismissPreview(): void {
  cancelPreviewHide();
  hoveredTurnId.value = null;
  focusedTurnId.value = null;
}

function selectTurn(messageId: string): void {
  dismissPreview();
  emit("select", messageId);
}

function updatePreviewOnScroll(): void {
  const list = markerList.value;
  const target = list?.querySelector<HTMLButtonElement>(":focus");
  hoveredTurnId.value = null;
  if (!list || !target || !focusedTurnId.value) return;
  const bounds = list.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (targetRect.top >= bounds.top && targetRect.bottom <= bounds.bottom)
    positionPreview(target);
  else focusedTurnId.value = null;
}

onBeforeUnmount(cancelPreviewHide);
</script>

<template>
  <nav
    ref="navigator"
    class="conversation-turn-navigator"
    :style="railStyle"
    :aria-label="t('conversationTurns')"
    @wheel.stop="scrollMarkers"
  >
    <button
      v-if="hasOverflow"
      type="button"
      class="icon-button conversation-turn-scroll-button is-previous"
      :disabled="!canScrollUp"
      :aria-label="t('earlierTurns')"
      :title="t('earlierTurns')"
      @click="scrollPage(-1)"
    >
      <AppIcon name="chevron" :size="14" />
    </button>
    <ol
      ref="markerList"
      class="conversation-turn-marker-list"
      @scroll="handleMarkerScroll"
    >
      <li v-for="turn in turns" :key="turn.id">
        <button
          type="button"
          class="conversation-turn-marker"
          :class="{ 'is-active': activeTurnId === turn.id }"
          :data-conversation-turn-id="turn.id"
          :aria-current="activeTurnId === turn.id ? 'location' : undefined"
          :aria-label="
            t('previewTurnValueValue', {
              arg0: turn.number,
              arg1: turn.prompt
            })
          "
          :aria-describedby="previewTurnId === turn.id ? previewId : undefined"
          @mouseenter="showPreview(turn.id, $event, 'hover')"
          @mouseleave="schedulePreviewHide(turn.id, 'hover')"
          @focus="showPreview(turn.id, $event, 'focus')"
          @blur="schedulePreviewHide(turn.id, 'focus')"
          @click="selectTurn(turn.id)"
        >
          <span class="conversation-turn-marker-line" aria-hidden="true" />
        </button>
      </li>
    </ol>
    <button
      v-if="hasOverflow"
      type="button"
      class="icon-button conversation-turn-scroll-button"
      :disabled="!canScrollDown"
      :aria-label="t('laterTurns')"
      :title="t('laterTurns')"
      @click="scrollPage(1)"
    >
      <AppIcon name="chevron" :size="14" />
    </button>
    <button
      v-if="previewTurn"
      :id="previewId"
      ref="preview"
      type="button"
      class="conversation-turn-preview is-visible"
      :class="{ 'is-compact': compactPreview }"
      :style="{ top: `${previewTop}px` }"
      :aria-label="
        t('goToTurnValueValue', {
          arg0: previewTurn.number,
          arg1: previewTurn.prompt
        })
      "
      @mouseenter="cancelPreviewHide"
      @mouseleave="dismissPreview"
      @focus="cancelPreviewHide"
      @blur="dismissPreview"
      @click="selectTurn(previewTurn.id)"
    >
      <span class="conversation-turn-preview-position">{{
        t("turnPosition", { arg0: previewTurn.number, arg1: turns.length })
      }}</span>
      <strong>{{ previewTurn.prompt }}</strong>
      <span v-if="previewTurn.response && !compactPreview">{{
        previewTurn.response
      }}</span>
    </button>
  </nav>
</template>
