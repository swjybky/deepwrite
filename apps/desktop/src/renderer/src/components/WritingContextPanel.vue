<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import {
  LONG_AGENTS_MD_MAX_CHARACTERS,
  MYSTERY_AGENTS_MD_MAX_CHARACTERS,
  WRITING_CONTEXT_MAX_CHARACTERS,
  writingContextCharacterCount,
  type WritingContextWorkspaceType
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.writingContextPanel");

export interface WritingContextSaveCompletion {
  succeed(): void;
  fail(): void;
}

const props = defineProps<{
  content: string | null;
  loading: boolean;
  pending: boolean;
  workspaceType: WritingContextWorkspaceType | "mystery" | "long";
}>();

const emit = defineEmits<{
  save: [content: string, completion: WritingContextSaveCompletion];
}>();

const draft = ref("");
const saved = ref("");
const isMystery = computed(() => props.workspaceType === "mystery");
const maxCharacters = computed(() =>
  props.workspaceType === "long"
    ? LONG_AGENTS_MD_MAX_CHARACTERS
    : isMystery.value
      ? MYSTERY_AGENTS_MD_MAX_CHARACTERS
      : WRITING_CONTEXT_MAX_CHARACTERS
);
const count = computed(() =>
  isMystery.value
    ? draft.value.length
    : writingContextCharacterCount(draft.value)
);
const dirty = computed(() => draft.value !== saved.value);
const contextLabels = {
  academic: "academicContext",
  mystery: "mysteryContext",
  script: "screenplayContext",
  short: "shortStoryContext",
  long: "novelContext"
} as const;
const label = computed(() => t(contextLabels[props.workspaceType]));

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

let saving: Promise<boolean> | null = null;

async function flushIfNeeded(): Promise<boolean> {
  if (saving) return false;
  if (!dirty.value) return true;
  if (props.loading || props.pending) return false;
  if (count.value > maxCharacters.value) {
    uiMessage.warning(
      t("valueSupportsUpToValueCharacters", {
        arg0: label.value,
        arg1: maxCharacters.value
      })
    );
    return false;
  }
  const content = draft.value;
  saving = new Promise<boolean>((resolve) => {
    emit("save", content, {
      succeed: () => {
        saved.value = content;
        resolve(true);
      },
      fail: () => resolve(false)
    });
  });
  try {
    return await saving;
  } finally {
    saving = null;
  }
}

defineExpose({ flushIfNeeded });
</script>

<template>
  <div class="writing-context-panel">
    <p v-if="loading" class="writing-context-loading" role="status">
      {{ t("readingContext") }}
    </p>
    <textarea
      v-else
      v-model="draft"
      :aria-label="t('valueContent', { arg0: label })"
      :disabled="pending"
      spellcheck="false"
    />
    <footer class="writing-context-footer">
      <span>{{
        t("unsavedChangesAreSavedAutomaticallyWhenSwitchingTabsOr")
      }}</span>
      <strong :class="{ 'is-over-limit': count > maxCharacters }"
        >{{ count }} / {{ maxCharacters }}</strong
      >
      <button
        class="dialog-primary-button"
        type="button"
        :disabled="
          loading ||
          pending ||
          !dirty ||
          (workspaceType === 'long' && count > maxCharacters)
        "
        @click="flushIfNeeded"
      >
        {{ pending ? t("saving") : t("saveContext") }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.writing-context-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 180px;
}

.writing-context-panel textarea,
.writing-context-loading {
  flex: 1;
  min-height: 0;
  margin: 0;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 12px;
  background: var(--surface-raised);
}

.writing-context-panel textarea {
  width: 100%;
  resize: none;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.65;
}

.writing-context-panel textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: 0;
}

.writing-context-loading {
  display: grid;
  place-items: center;
}

.writing-context-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.writing-context-footer span {
  flex: 1 1 180px;
}

.writing-context-footer strong {
  white-space: nowrap;
}

.writing-context-footer .is-over-limit {
  color: var(--danger-text);
}
</style>
