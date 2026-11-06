<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
  type CSSProperties,
  type ComponentPublicInstance
} from "vue";
import type {
  AgentUserInputAnswer,
  AgentUserInputQuestion,
  AgentUserInputRequestedPayload
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import AgentTeamPromptReview from "./AgentTeamPromptReview.vue";

const t = createScopedTranslator("components.agentUserInputCard");

const props = defineProps<{
  request: AgentUserInputRequestedPayload;
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [answers: AgentUserInputAnswer[]];
}>();

const selectedByQuestion = ref<Record<string, string[]>>({});
const textByQuestion = ref<Record<string, string>>({});
const customAnswerByQuestion = ref<Record<string, boolean>>({});
const activeQuestionIndex = ref(0);
const customAnswerInputs = new Map<string, HTMLTextAreaElement>();
const detailTooltip = ref<HTMLElement | null>(null);
const detailTitle = ref("");
const detailText = ref("");
const detailPosition = ref<CSSProperties>({ visibility: "hidden" });
let detailAnchor: HTMLElement | null = null;
let detailHideTimer: ReturnType<typeof setTimeout> | undefined;

function cancelDetailHide(): void {
  if (detailHideTimer) clearTimeout(detailHideTimer);
  detailHideTimer = undefined;
}

function hideOptionDetail(): void {
  cancelDetailHide();
  detailAnchor = null;
  detailTitle.value = "";
  detailText.value = "";
  detailPosition.value = { visibility: "hidden" };
}

function scheduleDetailHide(): void {
  cancelDetailHide();
  detailHideTimer = setTimeout(hideOptionDetail, 120);
}

async function showOptionDetail(event: MouseEvent): Promise<void> {
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLElement)) return;
  const description = anchor.querySelector<HTMLElement>(
    ".agent-user-input-description"
  );
  const descriptionText = description?.textContent?.trim() ?? "";
  const title = anchor.querySelector<HTMLElement>(
    ".agent-user-input-option-title strong"
  );
  const descriptionClipped =
    description && description.scrollWidth > description.clientWidth + 1;
  const titleClipped = title && title.scrollWidth > title.clientWidth + 1;
  if (!descriptionText || (!descriptionClipped && !titleClipped)) {
    hideOptionDetail();
    return;
  }
  cancelDetailHide();
  detailAnchor = anchor;
  detailTitle.value = title?.textContent?.trim() ?? "";
  detailText.value = descriptionText;
  const anchorRect = anchor.getBoundingClientRect();
  const width = `${anchorRect.width}px`;
  detailPosition.value = { visibility: "hidden", width };
  await nextTick();
  if (detailAnchor !== anchor || !detailTooltip.value) return;
  const tooltipRect = detailTooltip.value.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const left = Math.max(
    margin,
    Math.min(anchorRect.left, window.innerWidth - tooltipRect.width - margin)
  );
  const top = Math.max(
    margin,
    Math.min(
      anchorRect.bottom + gap + tooltipRect.height <=
        window.innerHeight - margin
        ? anchorRect.bottom + gap
        : anchorRect.top - tooltipRect.height - gap,
      window.innerHeight - tooltipRect.height - margin
    )
  );
  detailPosition.value = { left: `${left}px`, top: `${top}px`, width };
}

window.addEventListener("resize", hideOptionDetail);
onUnmounted(() => {
  hideOptionDetail();
  window.removeEventListener("resize", hideOptionDetail);
});

const visibleQuestions = computed(() =>
  props.request.questions.slice(
    activeQuestionIndex.value,
    activeQuestionIndex.value + 1
  )
);
const currentQuestion = computed(() => visibleQuestions.value[0]);
const isLastQuestion = computed(
  () => activeQuestionIndex.value >= props.request.questions.length - 1
);
const cardTitle = computed(() => currentQuestion.value?.question ?? "");
const requiresConfirmation = computed(
  () => currentQuestion.value?.multi_select === true
);
const showsSubmitButton = computed(
  () =>
    requiresConfirmation.value ||
    !currentQuestion.value?.options ||
    (currentQuestion.value
      ? customAnswerByQuestion.value[currentQuestion.value.id]
      : false)
);

function resetAnswers(): void {
  hideOptionDetail();
  activeQuestionIndex.value = 0;
  selectedByQuestion.value = Object.fromEntries(
    props.request.questions.map((question) => [question.id, []])
  );
  textByQuestion.value = Object.fromEntries(
    props.request.questions.map((question) => [question.id, ""])
  );
  customAnswerByQuestion.value = Object.fromEntries(
    props.request.questions.map((question) => [question.id, false])
  );
}

watch(() => props.request.requestId, resetAnswers, { immediate: true });

function selected(questionId: string, optionId: string): boolean {
  return selectedByQuestion.value[questionId]?.includes(optionId) ?? false;
}

function answers(): AgentUserInputAnswer[] {
  return props.request.questions.map((question) => {
    const selectedOptionIds = selectedByQuestion.value[question.id] ?? [];
    const text = textByQuestion.value[question.id]?.trim() ?? "";
    return {
      id: question.id,
      ...(selectedOptionIds.length ? { selectedOptionIds } : {}),
      ...(text ? { text } : {})
    };
  });
}

function chooseOption(
  question: AgentUserInputQuestion,
  optionId: string
): void {
  if (props.submitting) return;
  hideOptionDetail();
  const current = selectedByQuestion.value[question.id] ?? [];
  selectedByQuestion.value[question.id] = question.multi_select
    ? current.includes(optionId)
      ? current.filter((candidate) => candidate !== optionId)
      : [...current, optionId]
    : [optionId];
  if (question.multi_select !== true) {
    textByQuestion.value[question.id] = "";
    customAnswerByQuestion.value[question.id] = false;
  }

  if (question.multi_select !== true) {
    advanceOrSubmit();
  }
}

const canSubmit = computed(() =>
  currentQuestion.value
    ? (selectedByQuestion.value[currentQuestion.value.id]?.length ?? 0) > 0 ||
      !!textByQuestion.value[currentQuestion.value.id]?.trim()
    : false
);

function advanceOrSubmit(): void {
  if (isLastQuestion.value) {
    emit("submit", answers());
    return;
  }
  activeQuestionIndex.value += 1;
}

function submit(): void {
  if (!canSubmit.value || props.submitting) return;
  advanceOrSubmit();
}

function skip(): void {
  if (props.submitting) return;
  emit(
    "submit",
    props.request.questions.map((question) => ({
      id: question.id,
      text: t("skip")
    }))
  );
}

async function showCustomAnswer(
  question: AgentUserInputQuestion
): Promise<void> {
  customAnswerByQuestion.value[question.id] = true;
  if (question.multi_select !== true) {
    selectedByQuestion.value[question.id] = [];
  }
  await nextTick();
  customAnswerInputs.get(question.id)?.focus();
}

function setCustomAnswerInput(
  questionId: string,
  element: Element | ComponentPublicInstance | null
): void {
  if (element instanceof HTMLTextAreaElement) {
    customAnswerInputs.set(questionId, element);
    return;
  }
  customAnswerInputs.delete(questionId);
}

function optionLabel(label: string): string {
  return label.replace(/\s*\(Recommended\)\s*$/i, "");
}

function recommended(label: string): boolean {
  return /\s*\(Recommended\)\s*$/i.test(label);
}
</script>

<template>
  <section
    class="agent-user-input-card"
    :class="{ 'is-prompt-review': !!request.promptReview }"
    :aria-label="
      request.source === 'cross_stage_write'
        ? t('confirmOperationAcrossStages')
        : t('agentQuestion')
    "
  >
    <header class="agent-user-input-heading">
      <strong>{{ cardTitle }}</strong>
      <button
        class="agent-user-input-close"
        type="button"
        :aria-label="t('skipQuestion')"
        :disabled="submitting"
        @click="skip"
      >
        <AppIcon name="close" :size="18" />
      </button>
    </header>

    <div class="agent-user-input-questions" @scroll.passive="hideOptionDetail">
      <AgentTeamPromptReview
        v-if="request.promptReview"
        :review="request.promptReview"
        :request-id="request.requestId"
      />
      <fieldset
        v-for="question in visibleQuestions"
        :key="question.id"
        class="agent-user-input-question"
      >
        <div
          v-if="question.options"
          class="agent-user-input-options"
          :role="question.multi_select ? 'group' : 'radiogroup'"
        >
          <button
            v-for="(option, optionIndex) in question.options"
            :key="option.id"
            class="agent-user-input-option"
            :class="{
              'is-selected': selected(question.id, option.id),
              'is-recommended': recommended(option.label)
            }"
            type="button"
            :role="question.multi_select ? 'checkbox' : 'radio'"
            :aria-checked="selected(question.id, option.id)"
            :disabled="submitting"
            @mouseenter="showOptionDetail"
            @mouseleave="scheduleDetailHide"
            @click="chooseOption(question, option.id)"
          >
            <span class="agent-user-input-choice-mark">
              <AppIcon
                v-if="question.multi_select && selected(question.id, option.id)"
                name="check"
                :size="14"
              />
              <template v-else>{{ optionIndex + 1 }}</template>
            </span>
            <span class="agent-user-input-option-copy">
              <span class="agent-user-input-option-title">
                <strong>{{ optionLabel(option.label) }}</strong>
                <small v-if="recommended(option.label)">{{
                  t("recommended")
                }}</small>
              </span>
              <span
                v-if="option.description"
                class="agent-user-input-description"
              >
                {{ option.description }}
              </span>
            </span>
            <AppIcon
              v-if="question.multi_select !== true"
              class="agent-user-input-arrow"
              name="chevron"
              :size="20"
            />
          </button>
          <button
            v-if="!customAnswerByQuestion[question.id]"
            class="agent-user-input-custom-trigger"
            type="button"
            :role="question.multi_select ? 'checkbox' : 'radio'"
            aria-checked="false"
            :disabled="submitting"
            @click="showCustomAnswer(question)"
          >
            <span><AppIcon name="edit" :size="15" /></span>
            {{ t("writeYourOwnAnswer") }}
          </button>
        </div>

        <textarea
          v-if="!question.options || customAnswerByQuestion[question.id]"
          :ref="(element) => setCustomAnswerInput(question.id, element)"
          v-model="textByQuestion[question.id]"
          class="agent-user-input-text"
          rows="2"
          :placeholder="
            question.options ? t('writeYourOwnAnswer') : t('enterAnAnswer')
          "
          :disabled="submitting"
          :aria-label="
            t('textAnswerForValue', {
              arg0: question.question
            })
          "
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
      </fieldset>
    </div>

    <footer class="agent-user-input-actions">
      <span v-if="submitting">{{ t("submitting") }}</span>
      <span v-else-if="requiresConfirmation">{{
        t("confirmYourSelectionsToContinue")
      }}</span>
      <span v-else>{{ t("chooseAnOptionOrWriteYourOwnAnswer") }}</span>
      <div>
        <button
          v-if="showsSubmitButton"
          class="agent-user-input-submit"
          type="button"
          :disabled="!canSubmit || submitting"
          @click="submit"
        >
          {{
            submitting
              ? t("submittingLabel")
              : isLastQuestion
                ? t("confirm")
                : t("nextQuestion")
          }}
        </button>
        <button
          class="agent-user-input-skip"
          type="button"
          :disabled="submitting"
          @click="skip"
        >
          {{ t("skip") }}
        </button>
      </div>
    </footer>
  </section>
  <Teleport to="body">
    <Transition name="agent-user-input-tooltip">
      <div
        v-if="detailText"
        ref="detailTooltip"
        class="agent-user-input-tooltip"
        role="tooltip"
        :style="detailPosition"
        @mouseenter="cancelDetailHide"
        @mouseleave="hideOptionDetail"
      >
        <strong>{{ detailTitle }}</strong>
        <p v-if="detailText">{{ detailText }}</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="./AgentUserInputCard.css"></style>
