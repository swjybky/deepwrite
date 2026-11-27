<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, nextTick, ref, watch } from "vue";
import { useDialogKeyboard } from "../composables/useDialogKeyboard";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longBookRemovalDialog");

const props = defineProps<{
  open: boolean;
  action: "unregister" | "delete";
  title: string;
  pending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const isDelete = computed(() => props.action === "delete");
const dialogTitle = computed(() =>
  isDelete.value
    ? t("permanentlyDeleteThisNovelProject")
    : t("removeThisNovelFromTheWorkspace")
);
const confirmLabel = computed(() => {
  if (props.pending) {
    return isDelete.value ? t("deleting") : t("removing");
  }
  return isDelete.value ? t("deletePermanently") : t("confirmRemoval");
});

const dialogElement = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!props.pending) emit("close");
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      (cancelButton.value ?? dialogElement.value)?.focus({
        preventScroll: true
      });
      return;
    }
    const target = previousFocus;
    previousFocus = null;
    await nextTick();
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
);

useDialogKeyboard(dialogElement, { isOpen: () => props.open, close });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop long-removal-backdrop"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="long-removal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="long-removal-dialog-title"
        aria-describedby="long-removal-dialog-description"
        tabindex="-1"
      >
        <header>
          <span class="long-removal-icon" :class="{ 'is-danger': isDelete }">
            <AppIcon :name="isDelete ? 'trash' : 'archive'" :size="20" />
          </span>
          <div>
            <span>{{ t("novelWorkspace") }}</span>
            <h2 id="long-removal-dialog-title">{{ dialogTitle }}</h2>
          </div>
        </header>

        <div id="long-removal-dialog-description" class="long-removal-content">
          <strong :title="title">“{{ title }}”</strong>
          <template v-if="isDelete">
            <p>
              {{ t("theEntireNovelProjectFolderWillBePermanentlyDeleted") }}
            </p>
            <p class="long-removal-warning is-danger">
              {{ t("thisCannotBeUndoneMakeSureYouHaveBacked") }}
            </p>
          </template>
          <template v-else>
            <p>
              {{ t("thisOnlyUnregistersTheNovelFromTheWorkspaceThe") }}
            </p>
            <p class="long-removal-warning">
              {{ t("useOpenExistingWorkLaterToRegisterTheNovel") }}
            </p>
          </template>
        </div>

        <footer>
          <button
            ref="cancelButton"
            class="long-removal-secondary"
            type="button"
            :disabled="pending"
            @click="close"
          >
            {{ t("cancel") }}
          </button>
          <button
            class="long-removal-primary"
            :class="{ 'is-danger': isDelete }"
            type="button"
            :disabled="pending"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.long-removal-backdrop {
  z-index: 1800;
  padding: clamp(14px, 3vw, 24px);
}

.long-removal-dialog {
  width: min(490px, calc(100vw - 28px));
  max-height: calc(100vh - 28px);
  padding: clamp(16px, 3vw, 21px);
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 24px 68px rgb(0 0 0 / 32%);
  color: var(--text-primary);
}

.long-removal-dialog header {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.long-removal-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: var(--surface-selected);
  color: var(--text-secondary);
}

.long-removal-icon.is-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.long-removal-dialog header > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.long-removal-dialog header span {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-removal-dialog h2 {
  overflow-wrap: anywhere;
  font-size: 1.142857rem;
  font-weight: 650;
}

.long-removal-content {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.long-removal-content > strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.857143rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-removal-content p {
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.65;
}

.long-removal-warning {
  padding: 9px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-muted);
  color: var(--text-tertiary) !important;
  font-size: 0.714286rem !important;
}

.long-removal-warning.is-danger {
  border-color: color-mix(in srgb, var(--danger) 30%, var(--theme-line));
  background: color-mix(in srgb, var(--danger-soft) 72%, var(--surface-raised));
  color: var(--danger-text) !important;
}

.long-removal-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 19px;
}

.long-removal-dialog button {
  min-height: 34px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.75rem;
  cursor: pointer;
}

.long-removal-dialog button:disabled {
  cursor: default;
  opacity: 0.55;
}

.long-removal-secondary {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.long-removal-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-removal-primary {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

.long-removal-primary:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--neutral-solid) 88%,
    var(--theme-foreground)
  );
}

.long-removal-primary.is-danger {
  background: var(--danger);
  color: #fff;
}

.long-removal-primary.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 86%, #000);
}

@media (max-height: 520px) {
  .long-removal-dialog {
    padding: 14px 16px;
  }

  .long-removal-content {
    gap: 7px;
    margin-top: 12px;
  }

  .long-removal-dialog footer {
    margin-top: 14px;
  }
}
</style>
