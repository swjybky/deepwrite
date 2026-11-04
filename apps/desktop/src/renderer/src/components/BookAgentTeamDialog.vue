<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  saveBookAgentTeamBinding,
  useBookAgentTeamCatalog
} from "../composables/useBookAgentTeamBinding";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { bookAgentTeamBindingTarget as target } from "../stores/bookAgentTeamBindingDialog";
import { uiMessage } from "../ui-feedback";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";

const t = createScopedTranslator("components.bookAgentTeamBindings");

const { catalog, loaded } = useBookAgentTeamCatalog();
const teamIds = ref<string[]>([]);
const saving = ref(false);
const dialog = ref<HTMLElement | null>(null);

function close(): void {
  if (!saving.value) target.value = null;
}

async function submit(): Promise<void> {
  const book = target.value;
  if (!book || saving.value) return;
  saving.value = true;
  try {
    await saveBookAgentTeamBinding({
      bookId: book.bookId,
      workspaceType: book.workspaceType,
      // The list is a Vue proxy, which contextBridge cannot copy.
      teamIds: [...teamIds.value]
    });
    uiMessage.success(
      teamIds.value.length > 0
        ? t("bindingSavedItAppliesFromTheNextRun")
        : t("bindingRemovedThisBookUsesTheEnabledTeam")
    );
    target.value = null;
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("failedToSaveTheBinding")));
  } finally {
    saving.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (target.value && event.key === "Escape") close();
}

watch(
  [() => target.value?.bookId, loaded],
  ([bookId]) => {
    teamIds.value = [
      ...((bookId && catalog.value?.bookBindings?.[bookId]) || [])
    ];
    void nextTick(() => dialog.value?.focus());
  },
  { immediate: true }
);
onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="target" class="dialog-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="workspace-dialog book-binding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-agent-team-dialog-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ target.title }}</span>
            <h2 id="book-agent-team-dialog-title">{{ t("agentTeamLinks") }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="saving"
            @click="close"
          >
            ×
          </button>
        </header>
        <form
          class="dialog-content create-short-book-form"
          @submit.prevent="submit"
        >
          <BookAgentTeamBindings
            v-model="teamIds"
            :workspace-type="target.workspaceType"
            :disabled="saving"
          />
          <div class="dialog-actions create-short-book-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="saving"
              @click="close"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="saving || !loaded"
            >
              {{ saving ? t("saving") : t("saveLinks") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
