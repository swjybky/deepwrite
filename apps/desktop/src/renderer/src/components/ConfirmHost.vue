<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, useId, watch } from "vue";
import { settleUiConfirm, uiConfirmRequest } from "../ui-confirm";
import { trapFocus } from "../composables/useDialogKeyboard";

const t = createScopedTranslator("components.confirmHost");
const messageId = useId();
const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;

watch(
  () => uiConfirmRequest.value,
  async (request, previous) => {
    if (request && !previous) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      cancelButton.value?.focus();
    } else if (!request) {
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocus = null;
    }
  }
);

function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    settleUiConfirm(false);
    return;
  }
  trapFocus(event, dialog.value);
}
</script>
<template>
  <Teleport to="body">
    <div
      v-if="uiConfirmRequest"
      class="ui-confirm-backdrop"
      @mousedown.self="settleUiConfirm(false)"
      @keydown="keydown"
    >
      <section
        ref="dialog"
        class="ui-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-label="t('confirm')"
        :aria-describedby="messageId"
      >
        <p :id="messageId">{{ uiConfirmRequest.message }}</p>
        <footer>
          <button
            ref="cancelButton"
            type="button"
            @click="settleUiConfirm(false)"
          >
            {{ t("cancel") }}
          </button>
          <button
            :class="{ 'is-danger': uiConfirmRequest.danger }"
            type="button"
            @click="settleUiConfirm(true)"
          >
            {{ uiConfirmRequest.confirmLabel ?? t("confirm") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.ui-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1700;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--text-primary) 24%, transparent);
}
.ui-confirm-dialog {
  width: min(460px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  color: var(--text-primary);
  background: var(--surface-raised);
  font-family: var(--ui-font);
}
p {
  margin: 0 0 24px;
  line-height: 1.6;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
button {
  min-width: 86px;
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
button:hover {
  background: var(--surface-hover);
}
button.is-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
button.is-danger:hover {
  background: color-mix(in srgb, var(--danger) 86%, var(--text-primary));
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
