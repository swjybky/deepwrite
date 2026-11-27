<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref, watch } from "vue";
import { useDialogKeyboard } from "../composables/useDialogKeyboard";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator(
  "components.createLongWorldbuildingItemDialog"
);

const props = defineProps<{
  open: boolean;
  categoryTitle: string;
  pending?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [input: { title: string }];
}>();

const dialogElement = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const title = ref("");
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!props.pending) emit("close");
}

function submit(): void {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    uiMessage.warning(t("enterAWorldbuildingEntryName"));
    titleInput.value?.focus({ preventScroll: true });
    return;
  }
  emit("submit", {
    title: normalizedTitle
  });
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      title.value = "";
      await nextTick();
      titleInput.value?.focus({ preventScroll: true });
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
      class="dialog-backdrop create-worldbuilding-item-overlay"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="create-worldbuilding-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-long-worldbuilding-item-title"
        tabindex="-1"
      >
        <form @submit.prevent="submit">
          <header>
            <div>
              <span>{{
                t("worldbuildingMessage", { arg0: categoryTitle ?? "" })
              }}</span>
              <h2 id="create-long-worldbuilding-item-title">
                {{ t("newWorldbuildingEntry") }}
              </h2>
            </div>
            <button
              class="close-button"
              type="button"
              :aria-label="t('closeNewWorldbuildingEntryDialog')"
              :disabled="pending"
              @click="close"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>

          <fieldset :disabled="pending">
            <label>
              <span>{{ t("entryName") }}</span>
              <input
                ref="titleInput"
                v-model="title"
                maxlength="256"
                autocomplete="off"
                :placeholder="t('forExampleNightWatchers')"
                required
              />
            </label>
            <p>
              {{ t("aBlankEntryIsCreatedAfterConfirmationYouCan") }}
            </p>
          </fieldset>

          <footer>
            <button type="button" :disabled="pending" @click="close">
              {{ t("cancel") }}
            </button>
            <button class="primary-button" type="submit" :disabled="pending">
              {{ pending ? t("creating") : t("create") }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.create-worldbuilding-item-overlay {
  z-index: 2400;
  padding: 1rem;
}

.create-worldbuilding-item-dialog {
  width: min(32rem, 94vw);
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 1rem;
  background: var(--surface-raised);
  box-shadow: 0 1.4rem 4rem
    color-mix(in srgb, var(--text-primary) 18%, transparent);
  color: var(--text-primary);
}

form,
fieldset {
  display: grid;
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

header {
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--theme-line-soft);
}

header span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

h2 {
  margin: 0.2rem 0 0;
  font-size: 1.05rem;
}

.close-button {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
}

fieldset {
  min-width: 0;
  margin: 0;
  padding: 1.1rem;
  border: 0;
  gap: 0.9rem;
}

label {
  display: grid;
  gap: 0.4rem;
}

label > span {
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 650;
}

input,
button {
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}

input {
  width: 100%;
  padding: 0.65rem 0.75rem;
  outline: none;
  box-sizing: border-box;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 0.16rem var(--accent-soft);
}

fieldset p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.78rem;
  line-height: 1.55;
}

footer {
  justify-content: flex-end;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

button {
  min-height: 2.25rem;
  padding: 0.45rem 0.85rem;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--surface-hover);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.primary-button {
  border-color: var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

.primary-button:hover:not(:disabled) {
  border-color: color-mix(
    in srgb,
    var(--neutral-solid) 86%,
    var(--text-primary)
  );
  background: color-mix(in srgb, var(--neutral-solid) 86%, var(--text-primary));
}
</style>
