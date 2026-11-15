<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import { useLongChapterPlotBinding } from "../composables/useLongChapterPlotBinding";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import PopupSelect from "./PopupSelect.vue";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";

const t = createScopedTranslator("components.longChapterPlotBinding");
const props = defineProps<{
  bookId: string;
  chapterCardId: string;
  snapshot: LongWorkspaceIndexSnapshot;
  locked?: boolean;
}>();
const emit = defineEmits<{
  previewMutation: [
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
}>();
const editingChapterCardId = ref(props.chapterCardId);
const binding = useLongChapterPlotBinding({
  bookId: () => props.bookId,
  chapterCardId: () => editingChapterCardId.value,
  snapshot: () => props.snapshot,
  locked: () => Boolean(props.locked),
  preview: (batch, completion) => emit("previewMutation", batch, completion),
  mutate: (batch, completion) => emit("mutation", batch, completion),
  warn: (message) => uiMessage.warning(message)
});
const { chapter, open, primaryArcId, previewPending, pending, prepared } =
  binding;
const dialog = ref<HTMLElement | null>(null);
const selector = ref<InstanceType<typeof PopupSelect> | null>(null);
let returnFocusElement: HTMLElement | null = null;
const originalLabel = computed(
  () =>
    props.snapshot.plot.arcs.find(
      ({ id }) => id === chapter.value?.primaryArcId
    )?.title ?? t("unlinked")
);
const requestedLabel = computed(
  () =>
    props.snapshot.plot.arcs.find(({ id }) => id === primaryArcId.value)
      ?.title ?? t("unlinked")
);
const arcOptions = computed(() => [
  { value: "", label: t("unlinked") },
  ...props.snapshot.plot.arcs
    .filter(({ volumeId }) => volumeId === chapter.value?.volumeId)
    .sort((left, right) => left.order - right.order)
    .map(({ id, title }) => ({ value: id, label: title }))
]);

function edit(chapterCardId = props.chapterCardId): void {
  if (
    props.locked ||
    pending.value ||
    !props.snapshot.plot.chapterCards.some(({ id }) => id === chapterCardId)
  ) {
    return;
  }
  editingChapterCardId.value = chapterCardId;
  returnFocusElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  binding.edit();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    binding.close();
  }
  if (event.key !== "Tab") return;
  const elements = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [tabindex="0"]'
  );
  const first = elements?.[0];
  const last = elements?.[elements.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
watch(open, async (value) => {
  await nextTick();
  if (value) selector.value?.trigger?.focus();
  else if (returnFocusElement?.isConnected) returnFocusElement.focus();
});

defineExpose({ edit });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop binding-overlay"
      @mousedown.self="binding.close"
    >
      <section
        ref="dialog"
        class="binding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chapter-plot-binding-title"
        @keydown="handleKeydown"
      >
        <form @submit.prevent="binding.submit">
          <header>
            <h2 id="chapter-plot-binding-title">{{ t("changeBinding") }}</h2>
            <span>{{ chapter?.title }}</span>
          </header>
          <div class="binding-form">
            <label>
              <span>{{ t("primaryPlotPoint") }}</span>
              <PopupSelect
                ref="selector"
                :model-value="primaryArcId"
                :options="arcOptions"
                :accessible-label="t('choosePlotPoint')"
                :disabled="pending"
                :menu-z-index="2500"
                @update:model-value="primaryArcId = String($event)"
              />
            </label>
            <p>{{ t("sameVolumeHint") }}</p>
            <p v-if="prepared" class="binding-change">
              {{
                t("bindingChange", { from: originalLabel, to: requestedLabel })
              }}
            </p>
            <LongImpactConfirmationDetails
              v-if="prepared"
              :confirmation="prepared.confirmation"
              :open="false"
            />
          </div>
          <footer>
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="pending"
              @click="binding.close"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="primary-button"
              type="submit"
              :disabled="locked || pending || previewPending || !prepared"
            >
              {{
                pending
                  ? t("saving")
                  : previewPending
                    ? t("checking")
                    : t("save")
              }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.binding-overlay {
  z-index: 2400;
  padding: 1rem;
}
.binding-dialog {
  width: min(32rem, 100%);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 1rem;
  background: var(--surface-raised);
  color: var(--text-primary);
}
header,
footer {
  padding: 1rem;
}
header {
  border-bottom: 1px solid var(--theme-line-soft);
}
header h2 {
  margin: 0 0 0.3rem;
  font-size: 1.1rem;
}
header span {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.binding-form {
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
}
label {
  display: grid;
  gap: 0.5rem;
}
p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.5;
}
.binding-change {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
footer button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.5rem;
}
.primary-button {
  border-color: var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--surface-main);
}
.primary-button:disabled {
  opacity: 0.5;
}
</style>
