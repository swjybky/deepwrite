<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    eyebrow: string;
    title: string;
    action?: string | undefined;
    submitting?: boolean;
    disabled?: boolean;
    copy?: boolean;
    nested?: boolean;
  }>(),
  { open: true }
);
const emit = defineEmits<{ close: []; submit: [] }>();
const t = createScopedTranslator("components.exportShortManuscriptDialog");
const id = useId();
const panel = ref<HTMLElement>();
let previousFocus: HTMLElement | undefined;

function restoreFocus(): void {
  const target = previousFocus;
  previousFocus = undefined;
  void nextTick(() => target?.focus({ preventScroll: true }));
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      restoreFocus();
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      previousFocus = document.activeElement;
    }
    await nextTick();
    panel.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
onBeforeUnmount(restoreFocus);

function keepTabInDialog(event: KeyboardEvent): void {
  const elements = panel.value?.querySelectorAll<HTMLElement>(
    "button:enabled, input:enabled"
  );
  if (!elements?.length) {
    event.preventDefault();
    return;
  }
  const first = elements.item(0);
  const last = elements.item(elements.length - 1);
  const active = document.activeElement;
  const shouldWrap = event.shiftKey
    ? active === first || active === panel.value
    : active === last;
  if (!shouldWrap) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

function close(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  if (props.disabled || props.submitting) return;
  panel.value?.focus({ preventScroll: true });
  emit("submit");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop export-dialog-backdrop"
      :class="{ 'book-management-child': nested }"
      @mousedown.self="close"
    >
      <section
        ref="panel"
        class="workspace-dialog export-dialog-shell"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
        tabindex="-1"
        @keydown.esc.stop.prevent="close"
        @keydown.tab="keepTabInDialog"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ eyebrow }}</span>
            <h2 :id="id">{{ title }}</h2>
          </div>
          <button
            type="button"
            class="dialog-close"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="close"
          >
            ×
          </button>
        </header>

        <form
          :id="`${id}-form`"
          class="dialog-content export-dialog-content"
          @submit.prevent="submit"
        >
          <slot />
        </form>

        <footer class="export-dialog-footer">
          <span class="export-dialog-summary" aria-live="polite"
            ><slot name="summary"
          /></span>
          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="submitting"
              @click="close"
            >
              {{ t("cancel") }}
            </button>
            <button
              type="submit"
              class="dialog-primary-button"
              :form="`${id}-form`"
              :disabled="disabled || submitting"
            >
              <AppIcon :name="copy ? 'copy' : 'download'" :size="15" />
              <span class="export-dialog-button-label">
                <span :class="{ 'is-inactive': submitting }">{{
                  action ?? t("selectExportLocation")
                }}</span>
                <span :class="{ 'is-inactive': !submitting }">{{
                  t(copy ? "copying" : "exporting")
                }}</span>
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.export-dialog-backdrop {
  padding: 24px;
}
.export-dialog-shell {
  width: min(680px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow-wrap: anywhere;
}
.export-dialog-shell:focus {
  outline: none;
}
.export-dialog-shell .dialog-close {
  flex: none;
}
.export-dialog-content {
  display: grid;
  gap: 18px;
  overscroll-behavior: contain;
}
.export-dialog-footer {
  display: flex;
  flex-wrap: wrap;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--theme-line-soft);
}
.export-dialog-footer .dialog-actions {
  margin: 0 0 0 auto;
}
.export-dialog-button-label {
  display: grid;
}
.export-dialog-button-label > span {
  grid-area: 1 / 1;
}
.export-dialog-button-label .is-inactive {
  visibility: hidden;
}
.export-dialog-footer svg {
  flex: none;
}
.export-dialog-summary {
  color: var(--text-secondary);
  font-size: 0.785714rem;
}
.export-dialog-content :deep(.export-section-title) {
  color: var(--text-primary);
  font-size: 0.892857rem;
  font-weight: 620;
}
</style>
