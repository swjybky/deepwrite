<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import {
  WRITING_CONTEXT_MAX_CHARACTERS,
  writingContextCharacterCount,
  type WritingContextWorkspaceType
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { academicTreeT } from "./academic/academicTreeLabels";

const t = createScopedTranslator("components.writingContextPanel");

export interface WritingContextSaveCompletion {
  succeed(): void;
  fail(): void;
}

const props = defineProps<{
  content: string | null;
  loading: boolean;
  pending: boolean;
  workspaceType: WritingContextWorkspaceType;
}>();

const emit = defineEmits<{
  save: [content: string, completion: WritingContextSaveCompletion];
}>();

const draft = ref("");
const saved = ref("");
const count = computed(() => writingContextCharacterCount(draft.value));
const dirty = computed(() => draft.value !== saved.value);
const label = computed(() =>
  props.workspaceType === "academic"
    ? academicTreeT("academicContext")
    : props.workspaceType === "script"
      ? t("screenplayContext")
      : t("shortStoryContext")
);

watch(
  () => props.content,
  (content) => {
    const next = content ?? "";
    if (!dirty.value || next === draft.value) {
      draft.value = next;
      saved.value = next;
    }
  },
  { immediate: true }
);

async function flushIfNeeded(): Promise<boolean> {
  if (!dirty.value) return true;
  if (props.loading || props.pending) return false;
  if (count.value > WRITING_CONTEXT_MAX_CHARACTERS) {
    uiMessage.warning(
      t("valueSupportsUpToValueCharacters", {
        arg0: label.value,
        arg1: WRITING_CONTEXT_MAX_CHARACTERS
      })
    );
    return false;
  }
  const content = draft.value;
  return await new Promise<boolean>((resolve) => {
    emit("save", content, {
      succeed: () => {
        saved.value = content;
        resolve(true);
      },
      fail: () => resolve(false)
    });
  });
}

defineExpose({ flushIfNeeded });
</script>

<template>
  <section class="writing-context-panel" :aria-label="label">
    <header>
      <div>
        <p>AGENTS.MD</p>
        <h2>{{ label }}</h2>
        <span>
          {{ t("storeLastingCreativeMethodsAndConstraintsForThisWork") }}
        </span>
      </div>
      <button
        class="primary-button"
        type="button"
        :disabled="loading || pending || !dirty"
        @click="flushIfNeeded"
      >
        {{ pending ? t("saving") : t("saveContext") }}
      </button>
    </header>

    <div v-if="loading" class="context-loading">
      {{ t("readingContext") }}
    </div>
    <template v-else>
      <textarea
        v-model="draft"
        :aria-label="t('valueContent', { arg0: label })"
        :disabled="pending"
        spellcheck="false"
      />
      <footer
        :class="{ 'is-over-limit': count > WRITING_CONTEXT_MAX_CHARACTERS }"
      >
        <span>{{
          t("unsavedChangesAreSavedAutomaticallyWhenSwitchingTabsOr")
        }}</span>
        <strong>{{ count }} / {{ WRITING_CONTEXT_MAX_CHARACTERS }}</strong>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.writing-context-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  height: 100%;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-main);
}

.writing-context-panel > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.writing-context-panel header > div {
  display: grid;
  gap: 5px;
}

.writing-context-panel p,
.writing-context-panel h2 {
  margin: 0;
}

.writing-context-panel p {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  letter-spacing: 0.08em;
}

.writing-context-panel h2 {
  font-size: 1rem;
}

.writing-context-panel header span,
.writing-context-panel footer,
.context-loading {
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.writing-context-panel .primary-button {
  flex: 0 0 auto;
  min-height: 2rem;
  padding: 0.38rem 0.7rem;
  border: 1px solid var(--neutral-solid);
  border-radius: 0.55rem;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.writing-context-panel .primary-button:hover:not(:disabled) {
  border-color: color-mix(
    in srgb,
    var(--neutral-solid) 86%,
    var(--text-primary)
  );
  background: color-mix(in srgb, var(--neutral-solid) 86%, var(--text-primary));
  color: var(--accent-contrast, #ffffff);
}

.writing-context-panel .primary-button:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 0.2rem var(--accent-soft);
  outline: none;
}

.writing-context-panel .primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.writing-context-panel textarea {
  width: 100%;
  min-height: 320px;
  resize: none;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  padding: 14px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.65;
  outline: none;
}

.writing-context-panel textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.writing-context-panel textarea:disabled {
  opacity: 0.68;
}

.writing-context-panel footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.writing-context-panel footer strong {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.writing-context-panel footer.is-over-limit,
.writing-context-panel footer.is-over-limit strong {
  color: var(--danger, #c03d3d);
}

.context-loading {
  display: grid;
  place-items: center;
  min-height: 320px;
  border: 1px dashed var(--theme-line);
  border-radius: 10px;
  background: var(--surface-muted);
}

@media (max-width: 680px) {
  .writing-context-panel > header {
    align-items: stretch;
    flex-direction: column;
  }

  .writing-context-panel textarea,
  .context-loading {
    min-height: 240px;
  }
}
</style>
