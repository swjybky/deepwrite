<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ACADEMIC_BOOK_SUBTYPES,
  ACADEMIC_CITATION_STYLES,
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  isBuiltinAcademicFrameworkStageId,
  type AcademicBookSubtype,
  type AcademicCitationStyle
} from "@deepwrite/contracts/renderer";
import BookManagementRowActions from "../book-management/BookManagementRowActions.vue";
import AgentTeamSwitch from "../AgentTeamSwitch.vue";
import BookManagementChildDialog from "../book-management/BookManagementChildDialog.vue";
import BookManagementDialog, {
  type BookManagementSection
} from "../book-management/BookManagementDialog.vue";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import PopupSelect, { type PopupSelectValue } from "../PopupSelect.vue";
import WritingContextPanel, {
  type WritingContextSaveCompletion
} from "../WritingContextPanel.vue";
import {
  academicCitationStyleDescription,
  academicSubtypeDescription,
  academicT
} from "./academicLabels";
import {
  academicCitationStyleLabel,
  academicSubtypeLabel
} from "./academicTreeLabels";
import {
  executeAcademicFrameworkMutation,
  executeUpdateAcademicBookSettings,
  findAcademicIndexBook,
  loadAcademicWritingContext,
  saveAcademicWritingContext
} from "../../composables/useAcademicBookLifecycleCoordinator";
import {
  academicMutationPending,
  getAcademicLifecyclePort,
  type AcademicFrameworkDialogTab
} from "../../stores/academicWorkspaceDialog";
import { uiMessage } from "../../ui-feedback";
import { useRowOrderDrag } from "../../composables/useRowOrderDrag";

const props = defineProps<{
  bookId: string;
  initialTab?: AcademicFrameworkDialogTab | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

const contextT = createScopedTranslator("components.writingContextPanel");
const sections = computed<BookManagementSection<AcademicFrameworkDialogTab>[]>(
  () => [
    {
      id: "stages",
      group: "structure",
      label: academicT("frameworkTabStages"),
      description: academicT("frameworkPerBookNote")
    },
    {
      id: "settings",
      group: "settings",
      label: academicT("frameworkTabBookSettings"),
      description: academicT("frameworkSettingsDescription")
    },
    {
      id: "context",
      group: "context",
      label: contextT("academicContext"),
      description: contextT("storeLastingAcademicInstructions")
    }
  ]
);
const activeTab = ref<AcademicFrameworkDialogTab>(props.initialTab ?? "stages");
const writingContextPanel = ref<{ flushIfNeeded(): Promise<boolean> } | null>(
  null
);
const writingContext = ref<string | null>(null);
const writingContextLoading = ref(false);
const writingContextLoadFailed = ref(false);
const writingContextSaving = ref(false);

const stageFormOpen = ref(false);
const stageFormMode = ref<"create" | "edit">("create");
const editingStageId = ref<string | null>(null);
const deletingStageId = ref<string | null>(null);
const stageForm = reactive({
  title: "",
  description: ""
});

const book = computed(() => findAcademicIndexBook(props.bookId));
const renameOpen = computed(() =>
  getAcademicLifecyclePort()?.isBookRenameOpen?.(props.bookId)
);
const stages = computed(() => book.value?.frameworkStages ?? []);
const locked = computed(
  () => academicMutationPending.value || writingContextSaving.value
);
const childOpen = computed(
  () =>
    renameOpen.value || stageFormOpen.value || Boolean(deletingStageId.value)
);
const canReorderStages = computed(
  () => !locked.value && !childOpen.value && stages.value.length > 1
);
const stageOrderDrag = useRowOrderDrag<string>(
  "data-academic-stage-id",
  "button, input",
  (stageId) => {
    if (!canReorderStages.value) return;
    const bookId = props.bookId;
    const currentStages = stages.value;
    return {
      findTarget: (id) =>
        canReorderStages.value &&
        props.bookId === bookId &&
        stages.value === currentStages &&
        currentStages.some((stage) => stage.id === id)
          ? id
          : undefined,
      drop: (anchorId, position) => {
        void executeAcademicFrameworkMutation(bookId, {
          type: "reorder",
          stageId,
          anchorId,
          position
        });
      }
    };
  }
);

const draftSubtype = ref<AcademicBookSubtype>("empirical_paper");
const draftCitationStyle = ref<AcademicCitationStyle>("ieee");

watch(
  book,
  (current) => {
    if (!current) return;
    draftSubtype.value = current.subtype;
    draftCitationStyle.value = current.citationStyle;
  },
  { immediate: true }
);

const subtypeOptions = computed(() =>
  ACADEMIC_BOOK_SUBTYPES.map((subtype) => ({
    value: subtype,
    label: academicSubtypeLabel(subtype),
    description: academicSubtypeDescription(subtype)
  }))
);

const citationStyleOptions = computed(() =>
  ACADEMIC_CITATION_STYLES.map((style) => ({
    value: style,
    label: academicCitationStyleLabel(style),
    description: academicCitationStyleDescription(style)
  }))
);

const settingsDirty = computed(
  () =>
    Boolean(book.value) &&
    (draftSubtype.value !== book.value?.subtype ||
      draftCitationStyle.value !== book.value?.citationStyle)
);

async function ensureContextLoaded(): Promise<void> {
  if (writingContext.value !== null || writingContextLoading.value) return;
  writingContextLoading.value = true;
  writingContextLoadFailed.value = false;
  try {
    writingContext.value = await loadAcademicWritingContext(props.bookId);
  } catch (error: unknown) {
    writingContextLoadFailed.value = true;
    uiMessage.error(formatError(error, contextT("contextReadFailed")));
  } finally {
    writingContextLoading.value = false;
  }
}

watch(
  activeTab,
  (tab) => {
    if (tab === "context") {
      void ensureContextLoaded();
    }
  },
  { immediate: true }
);

async function switchTab(tab: AcademicFrameworkDialogTab): Promise<void> {
  if (tab === activeTab.value || locked.value) return;
  if (activeTab.value === "context") {
    const flushed = (await writingContextPanel.value?.flushIfNeeded()) ?? true;
    if (!flushed) return;
  }
  activeTab.value = tab;
}

async function requestClose(): Promise<void> {
  if (locked.value) return;
  if (activeTab.value === "context") {
    const flushed = (await writingContextPanel.value?.flushIfNeeded()) ?? true;
    if (!flushed) return;
  }
  emit("close");
}

async function openRename(): Promise<void> {
  const current = book.value;
  const launch = getAcademicLifecyclePort()?.openBookRename;
  if (
    !current ||
    !launch ||
    locked.value ||
    stageFormOpen.value ||
    deletingStageId.value
  )
    return;
  if (
    activeTab.value === "context" &&
    !(await writingContextPanel.value?.flushIfNeeded())
  )
    return;
  launch({
    id: current.id,
    label: current.title,
    workspaceType: "academic",
    ...(current.projectRevision !== undefined
      ? { projectRevision: current.projectRevision }
      : {})
  });
}

function openCreateStage(): void {
  if (locked.value) return;
  if (stages.value.length >= ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT) return;
  deletingStageId.value = null;
  stageFormMode.value = "create";
  editingStageId.value = null;
  stageForm.title = "";
  stageForm.description = "";
  stageFormOpen.value = true;
}

function openEditStage(stageId: string): void {
  if (locked.value) return;
  const stage = stages.value.find((item) => item.id === stageId);
  if (!stage) return;
  deletingStageId.value = null;
  stageFormMode.value = "edit";
  editingStageId.value = stage.id;
  stageForm.title = stage.title;
  stageForm.description = stage.description;
  stageFormOpen.value = true;
}

async function submitStageForm(): Promise<void> {
  const title = stageForm.title.trim();
  const description = stageForm.description.trim();
  if (!title) {
    uiMessage.warning(academicT("enterStageName"));
    return;
  }
  if (!description) {
    uiMessage.warning(academicT("enterStageDescription"));
    return;
  }
  if (
    stages.value.some(
      (stage) =>
        stage.id !== editingStageId.value &&
        stage.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    uiMessage.warning(academicT("duplicateStageName", { title }));
    return;
  }
  const ok =
    stageFormMode.value === "create"
      ? await executeAcademicFrameworkMutation(props.bookId, {
          type: "create",
          title,
          description
        })
      : editingStageId.value
        ? await executeAcademicFrameworkMutation(props.bookId, {
            type: "update",
            stageId: editingStageId.value,
            title,
            description
          })
        : false;
  if (ok) {
    stageFormOpen.value = false;
    editingStageId.value = null;
  }
}

async function toggleStageEnabled(
  stageId: string,
  enabled: boolean
): Promise<void> {
  if (locked.value) return;
  if (
    !enabled &&
    !stages.value.some((stage) => stage.id !== stageId && stage.enabled)
  ) {
    uiMessage.warning(academicT("keepAtLeastOneFrameworkStage"));
    return;
  }
  await executeAcademicFrameworkMutation(props.bookId, {
    type: "setEnabled",
    stageId,
    enabled
  });
}

async function moveStage(
  stageId: string,
  direction: "up" | "down"
): Promise<void> {
  if (locked.value) return;
  await executeAcademicFrameworkMutation(props.bookId, {
    type: "move",
    stageId,
    direction
  });
}

function requestDeleteStage(stageId: string): void {
  if (locked.value) return;
  if (isBuiltinAcademicFrameworkStageId(stageId)) {
    uiMessage.warning(academicT("builtinStageCannotDelete"));
    return;
  }
  stageFormOpen.value = false;
  deletingStageId.value = stageId;
}

async function confirmDeleteStage(): Promise<void> {
  const stageId = deletingStageId.value;
  if (!stageId || locked.value) return;
  const ok = await executeAcademicFrameworkMutation(props.bookId, {
    type: "delete",
    stageId
  });
  if (ok) {
    deletingStageId.value = null;
  }
}

function updateSubtype(value: PopupSelectValue): void {
  if (
    ACADEMIC_BOOK_SUBTYPES.includes(value as AcademicBookSubtype) &&
    !locked.value
  ) {
    draftSubtype.value = value as AcademicBookSubtype;
  }
}

function updateCitationStyle(value: PopupSelectValue): void {
  if (
    ACADEMIC_CITATION_STYLES.includes(value as AcademicCitationStyle) &&
    !locked.value
  ) {
    draftCitationStyle.value = value as AcademicCitationStyle;
  }
}

async function saveBookSettings(): Promise<void> {
  if (!settingsDirty.value || locked.value) return;
  await executeUpdateAcademicBookSettings(props.bookId, {
    subtype: draftSubtype.value,
    citationStyle: draftCitationStyle.value
  });
}

async function handleSaveWritingContext(
  content: string,
  completion: WritingContextSaveCompletion
): Promise<void> {
  writingContextSaving.value = true;
  try {
    const ok = await saveAcademicWritingContext(props.bookId, content);
    if (ok) {
      writingContext.value = content;
      completion.succeed();
    } else {
      completion.fail();
    }
  } finally {
    writingContextSaving.value = false;
  }
}

function closeChild(): void {
  if (locked.value) return;
  stageFormOpen.value = false;
  deletingStageId.value = null;
  editingStageId.value = null;
}
</script>

<template>
  <BookManagementDialog
    v-if="book"
    open
    :book-title="book.title"
    :book-type="academicT('academicWriting')"
    :sections="sections"
    :active="activeTab"
    :pending="locked"
    :child-open="childOpen"
    @close="requestClose"
    @rename="openRename"
    @select="switchTab"
  >
    <template #actions>
      <button
        v-if="activeTab === 'stages'"
        type="button"
        class="dialog-primary-button"
        :disabled="
          locked || stages.length >= ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT
        "
        @click="openCreateStage"
      >
        {{ academicT("newStage") }}
      </button>
      <button
        v-else-if="activeTab === 'settings'"
        type="button"
        class="dialog-primary-button"
        :disabled="locked || !settingsDirty"
        @click="saveBookSettings"
      >
        {{ locked ? academicT("saving") : academicT("save") }}
      </button>
    </template>

    <ol
      v-if="activeTab === 'stages'"
      class="book-management-list"
      :class="{ 'academic-stages-reorderable': canReorderStages }"
      @pointerdown="stageOrderDrag.start"
      @click.capture="stageOrderDrag.click"
    >
      <li
        v-for="(stage, index) in stages"
        :key="stage.id"
        class="book-management-row academic-framework-stage"
        :data-academic-stage-id="stage.id"
      >
        <AgentTeamSwitch
          :model-value="stage.enabled"
          :disabled="locked"
          :label="stage.title"
          @update:model-value="toggleStageEnabled(stage.id, $event)"
        />
        <div class="book-management-copy">
          <strong :title="stage.title">{{ stage.title }}</strong>
          <span>{{ stage.description }}</span>
          <div class="book-management-meta">
            <code :title="stage.id">{{ stage.id }}</code>
            <span class="book-management-label">{{
              isBuiltinAcademicFrameworkStageId(stage.id)
                ? academicT("builtinStage")
                : academicT("customStage")
            }}</span>
          </div>
        </div>
        <BookManagementRowActions
          :title="stage.title"
          :pending="locked"
          :up-disabled="index === 0"
          :down-disabled="index === stages.length - 1"
          :delete-disabled="isBuiltinAcademicFrameworkStageId(stage.id)"
          @move="moveStage(stage.id, $event)"
          @edit="openEditStage(stage.id)"
          @delete="requestDeleteStage(stage.id)"
        />
      </li>
    </ol>

    <div v-else-if="activeTab === 'settings'" class="book-management-settings">
      <div class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ academicT("subtypeLabel") }}</strong>
          <span>{{ academicSubtypeDescription(draftSubtype) }}</span>
        </div>
        <PopupSelect
          :model-value="draftSubtype"
          :options="subtypeOptions"
          :accessible-label="academicT('subtypeLabel')"
          :disabled="locked"
          :menu-z-index="2300"
          @update:model-value="updateSubtype"
        />
      </div>

      <div class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ academicT("citationStyleLabel") }}</strong>
          <span>{{
            academicCitationStyleDescription(draftCitationStyle)
          }}</span>
        </div>
        <PopupSelect
          :model-value="draftCitationStyle"
          :options="citationStyleOptions"
          :accessible-label="academicT('citationStyleLabel')"
          :disabled="locked"
          :menu-z-index="2300"
          @update:model-value="updateCitationStyle"
        />
      </div>
    </div>

    <button
      v-else-if="writingContextLoadFailed"
      type="button"
      class="dialog-secondary-button"
      @click="ensureContextLoaded"
    >
      {{ contextT("retryReadingContext") }}
    </button>
    <WritingContextPanel
      v-else
      :key="book.id"
      ref="writingContextPanel"
      :content="writingContext"
      :loading="writingContextLoading"
      :pending="writingContextSaving"
      workspace-type="academic"
      @save="handleSaveWritingContext"
    />

    <BookManagementChildDialog
      v-if="stageFormOpen"
      :title="
        stageFormMode === 'create'
          ? academicT('newStage')
          : academicT('editStage')
      "
      :pending="locked"
      @close="closeChild"
      @submit="submitStageForm"
    >
      <label class="book-management-field">
        <span>{{ academicT("stageName") }}</span>
        <input
          v-model="stageForm.title"
          maxlength="120"
          autocomplete="off"
          autofocus
          required
        />
      </label>
      <label class="book-management-field">
        <span>{{ academicT("stageDescription") }}</span>
        <textarea
          v-model="stageForm.description"
          rows="4"
          maxlength="4000"
          :placeholder="academicT('stageDescriptionHint')"
          required
        />
      </label>
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="locked"
          @click="closeChild"
        >
          {{ academicT("cancel") }}
        </button>
        <button class="dialog-primary-button" type="submit" :disabled="locked">
          {{
            locked
              ? academicT("saving")
              : stageFormMode === "create"
                ? academicT("create")
                : academicT("save")
          }}
        </button>
      </template>
    </BookManagementChildDialog>

    <BookManagementChildDialog
      v-else-if="deletingStageId"
      :title="
        academicT('deleteStageTitle', {
          title:
            stages.find((stage) => stage.id === deletingStageId)?.title ?? ''
        })
      "
      :pending="locked"
      confirm
      @close="closeChild"
      @submit="confirmDeleteStage"
    >
      <p class="dialog-description">
        {{ academicT("deleteStageDescription") }}
      </p>
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="locked"
          autofocus
          @click="closeChild"
        >
          {{ academicT("cancel") }}
        </button>
        <button
          class="dialog-primary-button is-danger"
          type="submit"
          :disabled="locked"
        >
          {{ academicT("delete") }}
        </button>
      </template>
    </BookManagementChildDialog>
  </BookManagementDialog>
</template>

<style scoped>
.academic-stages-reorderable .academic-framework-stage {
  cursor: grab;
  user-select: none;
}

.academic-framework-stage.row-order-ghost .book-management-copy code {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}
</style>
