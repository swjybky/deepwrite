<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import AppIcon from "../AppIcon.vue";
import PopupSelect, { type PopupSelectValue } from "../PopupSelect.vue";
import { academicT } from "./academicLabels";
import {
  executeAcademicManuscriptMutation,
  findAcademicIndexBook
} from "../../composables/useAcademicBookLifecycleCoordinator";
import { academicMutationPending } from "../../stores/academicWorkspaceDialog";
import { uiMessage } from "../../ui-feedback";

const UNASSIGNED_CHAPTER_VALUE = "__unassigned__";

const props = defineProps<{
  targetKind: "chapter" | "section";
  mode: "create" | "rename" | "edit" | "delete";
  bookId: string;
  chapterId?: string | undefined;
  sectionId?: string | undefined;
  title?: string | undefined;
  wordCountRequirement?: string | undefined;
  sectionCount?: number | undefined;
  afterSectionId?: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

const book = computed(() => findAcademicIndexBook(props.bookId));
const chapters = computed(() => book.value?.manuscript.chapters ?? []);
const sections = computed(() => book.value?.manuscript.sections ?? []);
const chapterSectionCount = computed(
  () =>
    props.sectionCount ??
    (props.chapterId
      ? sections.value.filter((item) => item.chapterId === props.chapterId)
          .length
      : 0)
);
const locked = computed(() => academicMutationPending.value);

const form = reactive({
  title: props.title ?? "",
  chapterChoice: props.chapterId ?? UNASSIGNED_CHAPTER_VALUE,
  wordCountRequirement: props.wordCountRequirement ?? ""
});

watch(
  () => [
    props.targetKind,
    props.mode,
    props.chapterId,
    props.sectionId,
    props.title,
    props.wordCountRequirement
  ],
  () => {
    form.title = props.title ?? "";
    form.chapterChoice = props.chapterId ?? UNASSIGNED_CHAPTER_VALUE;
    form.wordCountRequirement = props.wordCountRequirement ?? "";
  }
);

const chapterOptions = computed(() => [
  {
    value: UNASSIGNED_CHAPTER_VALUE,
    label: academicT("unassignedChapterOption")
  },
  ...chapters.value.map((chapter) => ({
    value: chapter.id,
    label: chapter.title
  }))
]);

const dialogHeading = computed(() => {
  if (props.targetKind === "chapter") {
    if (props.mode === "create") return academicT("newChapterTitle");
    if (props.mode === "rename") return academicT("renameChapterTitle");
    return academicT("deleteChapterTitle");
  }
  if (props.mode === "create") return academicT("newSectionTitle");
  if (props.mode === "edit") return academicT("editSectionTitle");
  return academicT("deleteSectionTitle");
});

function selectChapter(value: PopupSelectValue): void {
  if (typeof value === "string" && !locked.value) {
    form.chapterChoice = value;
  }
}

function requestClose(): void {
  if (locked.value) return;
  emit("close");
}

async function submit(): Promise<void> {
  if (locked.value) return;

  if (props.targetKind === "chapter") {
    if (props.mode === "delete") {
      if (!props.chapterId) return;
      const ok = await executeAcademicManuscriptMutation(props.bookId, {
        type: "delete-chapter",
        chapterId: props.chapterId,
        sectionAction: "unassign"
      });
      if (ok) emit("close");
      return;
    }
    const trimmed = form.title.trim();
    if (!trimmed) {
      uiMessage.warning(academicT("enterChapterTitleError"));
      return;
    }
    const ok =
      props.mode === "create"
        ? await executeAcademicManuscriptMutation(props.bookId, {
            type: "create-chapter",
            title: trimmed
          })
        : props.chapterId
          ? await executeAcademicManuscriptMutation(props.bookId, {
              type: "rename-chapter",
              chapterId: props.chapterId,
              title: trimmed
            })
          : false;
    if (ok) emit("close");
    return;
  }

  if (props.mode === "delete") {
    if (!props.sectionId) return;
    if (sections.value.length <= 1) {
      uiMessage.warning(academicT("keepAtLeastOneSection"));
      return;
    }
    const ok = await executeAcademicManuscriptMutation(props.bookId, {
      type: "delete-section",
      sectionId: props.sectionId
    });
    if (ok) emit("close");
    return;
  }

  const trimmed = form.title.trim();
  if (!trimmed) {
    uiMessage.warning(academicT("enterSectionTitleError"));
    return;
  }
  const resolvedChapterId =
    form.chapterChoice === UNASSIGNED_CHAPTER_VALUE ? null : form.chapterChoice;

  const ok =
    props.mode === "create"
      ? await executeAcademicManuscriptMutation(props.bookId, {
          type: "create-section",
          title: trimmed,
          chapterId: resolvedChapterId,
          wordCountRequirement: form.wordCountRequirement.trim(),
          ...(props.afterSectionId
            ? { afterSectionId: props.afterSectionId }
            : {})
        })
      : props.sectionId
        ? await executeAcademicManuscriptMutation(props.bookId, {
            type: "update-section-meta",
            sectionId: props.sectionId,
            title: trimmed,
            chapterId: resolvedChapterId,
            wordCountRequirement: form.wordCountRequirement.trim()
          })
        : false;
  if (ok) {
    emit("close");
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    requestClose();
  }
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div
    class="dialog-backdrop academic-dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      class="academic-manuscript-dialog"
      :role="mode === 'delete' ? 'alertdialog' : 'dialog'"
      aria-modal="true"
      aria-labelledby="academic-manuscript-dialog-title"
    >
      <header class="academic-manuscript-header">
        <div>
          <span class="academic-dialog-eyebrow">
            {{ academicT("manuscriptDialogEyebrow") }}
          </span>
          <h2 id="academic-manuscript-dialog-title">
            {{ dialogHeading }}
          </h2>
        </div>
        <button
          type="button"
          class="academic-dialog-close"
          :aria-label="academicT('close')"
          :disabled="locked"
          @click="requestClose"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <form class="academic-manuscript-body" @submit.prevent="submit">
        <template v-if="mode === 'delete'">
          <p class="academic-delete-copy">
            {{
              targetKind === "chapter"
                ? chapterSectionCount > 0
                  ? academicT("deleteChapterWithSectionsConfirm", {
                      title: title ?? "",
                      count: chapterSectionCount
                    })
                  : academicT("deleteEmptyChapterConfirm", {
                      title: title ?? ""
                    })
                : academicT("deleteSectionConfirm", { title: title ?? "" })
            }}
          </p>
        </template>

        <template v-else-if="targetKind === 'chapter'">
          <label class="academic-field">
            <span>{{ academicT("chapterTitleLabel") }}</span>
            <input
              v-model="form.title"
              maxlength="120"
              :placeholder="academicT('chapterTitlePlaceholder')"
              autocomplete="off"
              required
            />
          </label>
        </template>

        <template v-else>
          <label class="academic-field">
            <span>{{ academicT("sectionTitleLabel") }}</span>
            <input
              v-model="form.title"
              maxlength="120"
              :placeholder="academicT('sectionTitlePlaceholder')"
              autocomplete="off"
              required
            />
          </label>

          <label v-if="chapters.length > 0" class="academic-field">
            <span>{{ academicT("sectionChapterLabel") }}</span>
            <PopupSelect
              :model-value="form.chapterChoice"
              :options="chapterOptions"
              :accessible-label="academicT('sectionChapterLabel')"
              :disabled="locked"
              :menu-z-index="2300"
              @update:model-value="selectChapter"
            />
          </label>

          <label class="academic-field">
            <span>{{ academicT("sectionWordCountLabel") }}</span>
            <input
              v-model="form.wordCountRequirement"
              maxlength="200"
              :placeholder="academicT('sectionWordCountPlaceholder')"
              autocomplete="off"
            />
          </label>
        </template>

        <footer class="academic-manuscript-actions">
          <button
            type="button"
            class="academic-secondary-btn"
            :disabled="locked"
            @click="requestClose"
          >
            {{ academicT("cancel") }}
          </button>
          <button
            type="submit"
            :class="
              mode === 'delete' ? 'academic-danger-btn' : 'academic-primary-btn'
            "
            :disabled="locked"
          >
            {{
              locked
                ? academicT("saving")
                : mode === "delete"
                  ? academicT("delete")
                  : mode === "create"
                    ? academicT("create")
                    : academicT("save")
            }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.academic-dialog-backdrop {
  z-index: 2100;
}

.academic-manuscript-dialog {
  width: min(480px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.academic-manuscript-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-dialog-eyebrow {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.academic-manuscript-header h2 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.academic-dialog-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.academic-manuscript-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.academic-delete-copy {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-primary);
}

.academic-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.academic-field > span {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.academic-field input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.academic-manuscript-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.academic-secondary-btn,
.academic-primary-btn,
.academic-danger-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  cursor: pointer;
}

.academic-secondary-btn {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.academic-primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-contrast, #ffffff);
  font-weight: 500;
}

.academic-danger-btn {
  border: 1px solid var(--danger, #c93b3b);
  background: var(--danger, #c93b3b);
  color: #ffffff;
  font-weight: 500;
}

.academic-secondary-btn:disabled,
.academic-primary-btn:disabled,
.academic-danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
