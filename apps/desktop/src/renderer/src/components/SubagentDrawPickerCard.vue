<script setup lang="ts">
import {
  SUBAGENT_DRAW_REJECT_OPTION_ID,
  type AgentUserInputAnswer,
  type AgentUserInputDraw,
  type AgentUserInputRequestedPayload
} from "@deepwrite/contracts/renderer";
import { computed, ref, watch } from "vue";
import { createScopedTranslator, locale } from "../i18n";
import type { ChatMessage } from "../types/conversation";
import AppIcon from "./AppIcon.vue";
import StreamedContent from "./StreamedContent.vue";
import SubagentDrawCompareDialog from "./SubagentDrawCompareDialog.vue";
import {
  drawCandidateLength,
  drawCandidateNumber,
  drawSelectionAnswers,
  otherPendingDrawCount
} from "./subagentDrawCandidates";

const t = createScopedTranslator("components.subagentDrawPicker");

const props = defineProps<{
  request: AgentUserInputRequestedPayload & { draw: AgentUserInputDraw };
  submitting: boolean;
  messages: readonly ChatMessage[];
}>();

const emit = defineEmits<{
  submit: [answers: AgentUserInputAnswer[]];
}>();

const NOTE_MAX_LENGTH = 4_000;
const activeId = ref("");
const note = ref("");
const comparing = ref(false);
const draw = computed(() => props.request.draw);
const active = computed(
  () =>
    draw.value.candidates.find(
      (candidate) => candidate.id === activeId.value
    ) ?? draw.value.candidates[0]!
);
const subtitle = computed(() => {
  const pending = otherPendingDrawCount(props.messages, draw.value);
  return [
    draw.value.name,
    ...(draw.value.taskKey ? [draw.value.taskKey] : []),
    t("valueCandidates", { arg0: draw.value.candidates.length }),
    ...(pending ? [t("valueMoreWaiting", { arg0: pending })] : [])
  ].join(" · ");
});

watch(
  () => props.request.requestId,
  () => {
    activeId.value = draw.value.candidates[0]?.id ?? "";
    note.value = "";
    comparing.value = false;
  },
  { immediate: true }
);

function lengthLabel(text: string): string {
  return t("valueCharacters", {
    arg0: drawCandidateLength(text).toLocaleString(locale.value)
  });
}

function choose(optionId: string): void {
  if (props.submitting) return;
  emit("submit", drawSelectionAnswers(optionId, note.value));
}

function selectByOffset(offset: number): void {
  const candidates = draw.value.candidates;
  const index = candidates.indexOf(active.value);
  const next =
    candidates[(index + offset + candidates.length) % candidates.length];
  if (next) activeId.value = next.id;
}

/** Number keys jump to a candidate; arrows move along the strip. */
function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea")) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    selectByOffset(event.key === "ArrowRight" ? 1 : -1);
    event.preventDefault();
    return;
  }
  const number = event.key === "0" ? 10 : Number(event.key);
  const candidate = draw.value.candidates.find(
    (item) => drawCandidateNumber(item) === number
  );
  if (candidate) {
    activeId.value = candidate.id;
    event.preventDefault();
  }
}

function adoptFromCompare(optionId: string): void {
  comparing.value = false;
  choose(optionId);
}
</script>

<template>
  <section
    class="draw-picker"
    :aria-label="t('chooseOneForThePrimaryAgent')"
    :aria-busy="submitting"
    @keydown="handleKeydown"
  >
    <header class="draw-picker-heading">
      <div class="draw-picker-titles">
        <strong>{{ t("chooseOneForThePrimaryAgent") }}</strong>
        <span>{{ subtitle }}</span>
      </div>
      <button
        type="button"
        class="draw-picker-compare"
        :disabled="submitting || draw.candidates.length < 2"
        :title="t('compareSideBySide')"
        @click="comparing = true"
      >
        <AppIcon name="panel-right" :size="15" />
        <span>{{ t("compare") }}</span>
      </button>
    </header>

    <div class="draw-picker-body">
      <p v-if="draw.fallbackReason" class="draw-picker-notice">
        {{ draw.fallbackReason }}
      </p>
      <details class="draw-picker-task">
        <summary>{{ t("taskAssignedByPrimaryAgent") }}</summary>
        <p>{{ draw.task }}</p>
      </details>

      <div
        class="draw-picker-tabs"
        role="tablist"
        :aria-label="t('candidates')"
      >
        <button
          v-for="candidate in draw.candidates"
          :key="candidate.id"
          type="button"
          role="tab"
          class="draw-picker-tab"
          :class="{ 'is-active': candidate.id === active.id }"
          :aria-selected="candidate.id === active.id"
          :tabindex="candidate.id === active.id ? 0 : -1"
          :title="candidate.variant"
          @click="activeId = candidate.id"
        >
          <strong>{{
            t("candidateValue", { arg0: drawCandidateNumber(candidate) })
          }}</strong>
          <span>{{ lengthLabel(candidate.text) }}</span>
        </button>
      </div>

      <p
        v-if="active.variant"
        class="draw-picker-variant"
        :title="active.variant"
      >
        {{ t("variantValue", { arg0: active.variant }) }}
      </p>
      <div class="draw-picker-preview" role="tabpanel">
        <StreamedContent :content="active.text" format="markdown" />
      </div>
    </div>

    <footer class="draw-picker-actions">
      <input
        v-model="note"
        class="draw-picker-note"
        type="text"
        :maxlength="NOTE_MAX_LENGTH"
        :placeholder="t('noteForThePrimaryAgentOptional')"
        :aria-label="t('noteForThePrimaryAgent')"
        :disabled="submitting"
        @keydown.enter.exact.prevent="choose(active.id)"
      />
      <div class="draw-picker-buttons">
        <button
          type="button"
          class="dialog-secondary-button"
          :disabled="submitting"
          @click="choose(SUBAGENT_DRAW_REJECT_OPTION_ID)"
        >
          {{ t("adoptNone") }}
        </button>
        <button
          type="button"
          class="dialog-primary-button"
          :disabled="submitting"
          @click="choose(active.id)"
        >
          {{ t("adoptCandidateValue", { arg0: drawCandidateNumber(active) }) }}
        </button>
      </div>
    </footer>

    <SubagentDrawCompareDialog
      v-if="comparing"
      v-model:note="note"
      :draw="draw"
      :initial-id="active.id"
      :submitting="submitting"
      @adopt="adoptFromCompare"
      @close="comparing = false"
    />
  </section>
</template>

<style scoped src="./SubagentDrawPickerCard.css"></style>
