<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type { ResourceTreeNode } from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { academicTreeT } from "./academic/academicTreeLabels";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.bookResourceDialog");

const props = defineProps<{
  mode: "rename" | "remove" | "delete" | null;
  book: ResourceTreeNode | null;
  submitting?: boolean;
  backdropClass?: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
  rename: [payload: { bookId: string; label: string }];
  remove: [bookId: string];
  delete: [bookId: string];
}>();

const nameDraft = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const bookTypeLabel = computed(() =>
  props.book?.workspaceType === "academic"
    ? academicTreeT("academicWork")
    : props.book?.workspaceType === "mystery"
      ? mysteryLabels("murderMystery")
      : props.book?.workspaceType === "script"
        ? t("screenplay")
        : t("book")
);
const title = computed(() => {
  if (props.mode === "rename")
    return t("renameValue", {
      arg0: bookTypeLabel.value
    });
  if (props.mode === "remove")
    return t("removeValue", {
      arg0: bookTypeLabel.value
    });
  return t("deleteValue", { arg0: bookTypeLabel.value });
});

watch(
  () => [props.mode, props.book] as const,
  () => {
    nameDraft.value = props.book?.label ?? "";
    if (props.mode === "rename") {
      void nextTick(() => {
        nameInput.value?.focus();
        nameInput.value?.select();
      });
    }
  },
  { immediate: true }
);

function submit(): void {
  if (!props.book || !props.mode || props.submitting) return;
  if (props.mode === "rename") {
    const label = nameDraft.value.trim();
    if (!label) {
      uiMessage.warning(t("enterABookName"));
      nameInput.value?.focus();
      return;
    }
    emit("rename", { bookId: props.book.id, label });
    return;
  }
  if (props.mode === "remove") {
    emit("remove", props.book.id);
    return;
  }
  if (props.mode === "delete") {
    emit("delete", props.book.id);
    return;
  }
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.mode && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="mode && book"
      class="dialog-backdrop"
      :class="backdropClass"
      @mousedown.self="requestClose"
    >
      <section
        class="workspace-dialog book-resource-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`book-resource-dialog-${mode}`"
      >
        <header>
          <div>
            <span v-if="!backdropClass" class="dialog-eyebrow">{{
              book.label
            }}</span>
            <h2 :id="`book-resource-dialog-${mode}`">{{ title }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="submit">
          <template v-if="mode === 'rename'">
            <label class="book-resource-name-field">
              <span>{{
                t("nameMessage", {
                  arg0: bookTypeLabel ?? ""
                })
              }}</span>
              <input
                ref="nameInput"
                v-model="nameDraft"
                type="text"
                maxlength="80"
                autocomplete="off"
                :aria-label="
                  t('valueName', {
                    arg0: bookTypeLabel
                  })
                "
              />
            </label>
            <p class="book-resource-help">
              {{ t("theSidebarAndManuscriptDisplayPathsWillUpdateThe") }}
            </p>
          </template>

          <template v-else-if="mode === 'remove' || mode === 'delete'">
            <div class="book-remove-warning">
              <AppIcon name="trash" :size="20" />
              <div>
                <strong>{{
                  t("summaryMessage", {
                    arg0: (mode === "delete" ? t("delete") : t("remove")) ?? "",
                    arg1: book.label ?? ""
                  })
                }}</strong>
                <p v-if="mode === 'delete'">
                  {{ t("willBeRemovedFromTheWorkspaceAndItsLocal") }}
                </p>
                <p v-else>
                  {{
                    t("thisOnlyUnregistersTheWorkFromTheMessage", {
                      arg0: bookTypeLabel ?? ""
                    })
                  }}
                </p>
              </div>
            </div>
          </template>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              :class="{ 'is-danger': mode === 'delete' }"
              type="submit"
              :disabled="submitting"
            >
              {{
                submitting
                  ? mode === "remove" || mode === "delete"
                    ? t("processing")
                    : t("saving")
                  : mode === "delete"
                    ? t("deleteLabel")
                    : mode === "remove"
                      ? t("confirmRemoval")
                      : t("saveName")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
