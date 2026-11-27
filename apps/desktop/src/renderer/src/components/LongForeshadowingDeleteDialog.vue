<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, watch } from "vue";
import { useDialogKeyboard } from "../composables/useDialogKeyboard";
import type { LongForeshadowingDeleteTarget } from "../composables/useLongForeshadowingDeleteConfirmation";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";

const t = createScopedTranslator("components.longForeshadowingDeleteDialog");

const props = withDefaults(
  defineProps<{
    target: LongForeshadowingDeleteTarget | null;
    title: string;
    locked?: boolean;
    pending?: boolean;
  }>(),
  {
    locked: false,
    pending: false
  }
);
const emit = defineEmits<{ close: []; confirm: [] }>();
const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

watch(
  () => props.target,
  (target) => {
    if (target) void nextTick(() => cancelButton.value?.focus());
  }
);
useDialogKeyboard(dialog, {
  isOpen: () => Boolean(props.target),
  close: () => emit("close")
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="target"
      class="dialog-backdrop delete-overlay"
      @mousedown.self="emit('close')"
    >
      <section
        ref="dialog"
        class="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="foreshadow-delete-title"
        aria-describedby="foreshadow-delete-description"
        tabindex="-1"
      >
        <header>
          <div>
            <span>DELETE</span>
            <h3 id="foreshadow-delete-title">{{ title }}</h3>
          </div>
        </header>
        <div class="body">
          <p v-if="target.previewPending" id="foreshadow-delete-description">
            {{ t("checkingLinksAndDeletionImpact") }}
          </p>
          <LongImpactConfirmationDetails
            v-else-if="target.expectedImpact"
            :confirmation="target.expectedImpact"
            :fallback="
              target.kind === 'thread'
                ? t(
                    'allValueTouchpointsBelongingToThisForeshadowingThreadWill',
                    { arg0: target.thread.beats.length }
                  )
                : t('thisDeletesOnlyThisTouchpointTheSameThreadIn')
            "
          />
        </div>
        <footer>
          <button
            ref="cancelButton"
            type="button"
            :disabled="locked || target.previewPending"
            @click="emit('close')"
          >
            {{ t("cancel") }}
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="
              locked || target.previewPending || !target.expectedImpact
            "
            @click="emit('confirm')"
          >
            {{
              pending
                ? t("deleting")
                : target.previewPending
                  ? t("checking")
                  : target.kind === "thread" && target.thread.beats.length
                    ? t("deleteForeshadowingThreadAndTouchpoints")
                    : t("delete")
            }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.delete-overlay {
  z-index: 2200;
  overflow: auto;
  padding: 1rem;
}
.delete-dialog {
  width: min(31rem, 100%);
  max-height: min(88vh, 48rem);
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 0.9rem;
  color: var(--text-primary);
  background: var(--surface-main);
  box-shadow: 0 1.2rem 3.5rem
    color-mix(in srgb, var(--theme-foreground) 24%, transparent);
  font-size: 0.875rem;
}
header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
}
header {
  border-bottom: 1px solid var(--theme-line-soft);
}
header h3 {
  margin: 0.15rem 0 0;
}
header span {
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.body {
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
}
.body p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}
footer {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
.danger-button {
  border-color: var(--danger);
  color: #fff;
  background: var(--danger);
  font-weight: 650;
}
</style>
