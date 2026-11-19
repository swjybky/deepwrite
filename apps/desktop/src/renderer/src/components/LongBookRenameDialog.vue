<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.longBookRenameDialog");

const props = defineProps<{
  open: boolean;
  title: string;
  pending?: boolean;
  nested?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [title: string];
}>();

const nameDraft = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

watch(
  () => [props.open, props.title] as const,
  ([open, title]) => {
    if (!open) return;
    nameDraft.value = title;
    void nextTick(() => {
      nameInput.value?.focus();
      nameInput.value?.select();
    });
  },
  { immediate: true }
);

function requestClose(): void {
  if (!props.pending) emit("close");
}

function submit(): void {
  if (props.pending) return;
  const title = nameDraft.value.trim();
  if (!title) {
    uiMessage.warning(t("enterANovelName"));
    nameInput.value?.focus();
    return;
  }
  emit("submit", title);
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      :class="{ 'book-management-child': nested }"
      @mousedown.self="requestClose"
    >
      <section
        class="workspace-dialog book-resource-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="long-book-rename-dialog-title"
      >
        <header>
          <div>
            <span v-if="!nested" class="dialog-eyebrow">{{ title }}</span>
            <h2 id="long-book-rename-dialog-title">
              {{ t("renameNovel") }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="pending"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="submit">
          <label class="book-resource-name-field">
            <span>{{ t("novelName") }}</span>
            <input
              ref="nameInput"
              v-model="nameDraft"
              type="text"
              maxlength="256"
              autocomplete="off"
              :aria-label="t('novelName')"
            />
          </label>
          <p class="book-resource-help">
            {{ t("theSidebarAndNovelWorkspaceWillShowTheNew") }}
          </p>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="pending"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="pending"
            >
              {{ pending ? t("saving") : t("saveName") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
