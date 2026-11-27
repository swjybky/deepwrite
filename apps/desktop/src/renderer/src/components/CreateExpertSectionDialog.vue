<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, nextTick, ref, watch } from "vue";
import { useDialogKeyboard } from "../composables/useDialogKeyboard";
import { DraftSectionTitleSchema } from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.createExpertSectionDialog");

const props = defineProps<{
  open: boolean;
  suggestedTitle: string;
  workspaceType?: "short" | "script" | undefined;
  pending?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [title: string];
}>();

const dialogElement = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const title = ref("");
let previousFocus: HTMLElement | null = null;

const unitLabel = computed(() =>
  props.workspaceType === "script" ? t("episode") : t("section")
);

function close(): void {
  if (!props.pending) emit("close");
}

function submit(): void {
  if (props.pending) return;
  const parsed = DraftSectionTitleSchema.safeParse(title.value);
  if (!parsed.success) {
    uiMessage.warning(
      t("enterAValueName", {
        arg0: unitLabel.value
      })
    );
    titleInput.value?.focus({ preventScroll: true });
    return;
  }
  emit("submit", parsed.data);
}

watch(
  () => [props.open, props.suggestedTitle] as const,
  async ([open, suggestedTitle]) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      title.value = suggestedTitle;
      await nextTick();
      titleInput.value?.focus({ preventScroll: true });
      titleInput.value?.select();
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
      class="dialog-backdrop create-expert-section-overlay"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="create-expert-section-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-expert-section-title"
        tabindex="-1"
      >
        <form @submit.prevent="submit">
          <header>
            <div>
              <span>{{ t("manuscriptWriting") }}</span>
              <h2 id="create-expert-section-title">
                {{
                  t("newMessage", {
                    arg0: unitLabel ?? ""
                  })
                }}
              </h2>
            </div>
            <button
              class="close-button"
              type="button"
              :aria-label="t('closeCreationDialog')"
              :disabled="pending"
              @click="close"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>

          <fieldset :disabled="pending">
            <label>
              <span>{{
                t("nameMessage", {
                  arg0: unitLabel ?? ""
                })
              }}</span>
              <input
                ref="titleInput"
                v-model="title"
                maxlength="240"
                autocomplete="off"
                :placeholder="
                  t('forExampleValue', {
                    arg0:
                      suggestedTitle ||
                      t('newValue', {
                        arg0: unitLabel
                      })
                  })
                "
                required
              />
            </label>
            <p>
              {{
                t("confirmationAddsABlankAtTheEndMessage", {
                  arg0: unitLabel ?? ""
                })
              }}
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
.create-expert-section-overlay {
  z-index: 2400;
  padding: 1rem;
}

.create-expert-section-dialog {
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
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 0.16rem var(--accent-soft);
}

fieldset p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.78rem;
  line-height: 1.5;
}

footer {
  justify-content: flex-end;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--theme-line-soft);
  border-radius: 0 0 1rem 1rem;
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
