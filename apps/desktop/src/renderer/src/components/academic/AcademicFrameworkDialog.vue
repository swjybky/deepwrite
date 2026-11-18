<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import {
  ACADEMIC_BOOK_SUBTYPES,
  ACADEMIC_CITATION_STYLES,
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  isBuiltinAcademicFrameworkStageId,
  type AcademicBookSubtype,
  type AcademicCitationStyle
} from "@deepwrite/contracts/renderer";
import AppIcon from "../AppIcon.vue";
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
  academicSubtypeLabel,
  academicTreeT
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
  type AcademicFrameworkDialogTab
} from "../../stores/academicWorkspaceDialog";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  bookId: string;
  initialTab?: AcademicFrameworkDialogTab | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

const activeTab = ref<AcademicFrameworkDialogTab>(props.initialTab ?? "stages");
const writingContextPanel = ref<{ flushIfNeeded(): Promise<boolean> } | null>(
  null
);
const writingContext = ref<string | null>(null);
const writingContextLoading = ref(false);
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
const stages = computed(() => book.value?.frameworkStages ?? []);
const locked = computed(
  () => academicMutationPending.value || writingContextSaving.value
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
  try {
    writingContext.value = await loadAcademicWritingContext(props.bookId);
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
  if (stageFormOpen.value || deletingStageId.value) {
    stageFormOpen.value = false;
    deletingStageId.value = null;
    editingStageId.value = null;
    return;
  }
  if (activeTab.value === "context") {
    const flushed = (await writingContextPanel.value?.flushIfNeeded()) ?? true;
    if (!flushed) return;
  }
  emit("close");
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

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    void requestClose();
  }
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div
    v-if="book"
    class="dialog-backdrop academic-dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      class="academic-framework-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="academic-framework-dialog-title"
    >
      <header class="academic-framework-header">
        <div>
          <span class="academic-dialog-eyebrow">
            {{ academicT("frameworkDialogEyebrow") }}
          </span>
          <h2 id="academic-framework-dialog-title">
            {{ academicT("frameworkDialogTitle", { title: book.title }) }}
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

      <div class="academic-framework-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="academic-framework-tab"
          :class="{ 'is-active': activeTab === 'stages' }"
          :aria-selected="activeTab === 'stages'"
          @click="switchTab('stages')"
        >
          {{ academicT("frameworkTabStages") }}
        </button>
        <button
          type="button"
          role="tab"
          class="academic-framework-tab"
          :class="{ 'is-active': activeTab === 'settings' }"
          :aria-selected="activeTab === 'settings'"
          @click="switchTab('settings')"
        >
          {{ academicT("frameworkTabSettings") }}
        </button>
        <button
          type="button"
          role="tab"
          class="academic-framework-tab"
          :class="{ 'is-active': activeTab === 'context' }"
          :aria-selected="activeTab === 'context'"
          @click="switchTab('context')"
        >
          {{ academicTreeT("academicContext") }}
        </button>
      </div>

      <div class="academic-framework-body">
        <template v-if="activeTab === 'stages'">
          <div class="academic-framework-intro">
            <p>{{ academicT("frameworkPerBookNote") }}</p>
            <button
              type="button"
              class="academic-primary-btn"
              :disabled="
                locked || stages.length >= ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT
              "
              @click="openCreateStage"
            >
              <AppIcon name="plus" :size="14" />
              {{ academicT("newStage") }}
            </button>
          </div>

          <form
            v-if="stageFormOpen"
            class="academic-stage-form"
            @submit.prevent="submitStageForm"
          >
            <h3>
              {{
                stageFormMode === "create"
                  ? academicT("newStage")
                  : academicT("editStage")
              }}
            </h3>
            <label class="academic-field">
              <span>{{ academicT("stageName") }}</span>
              <input
                v-model="stageForm.title"
                maxlength="120"
                autocomplete="off"
                required
              />
            </label>
            <label class="academic-field">
              <span>{{ academicT("stageDescription") }}</span>
              <textarea
                v-model="stageForm.description"
                rows="4"
                maxlength="4000"
                :placeholder="academicT('stageDescriptionHint')"
                required
              />
            </label>
            <div class="academic-inline-actions">
              <button
                type="button"
                class="academic-secondary-btn"
                :disabled="locked"
                @click="stageFormOpen = false"
              >
                {{ academicT("cancel") }}
              </button>
              <button
                type="submit"
                class="academic-primary-btn"
                :disabled="locked"
              >
                {{
                  locked
                    ? academicT("saving")
                    : stageFormMode === "create"
                      ? academicT("create")
                      : academicT("save")
                }}
              </button>
            </div>
          </form>

          <div
            v-if="deletingStageId"
            class="academic-confirm-banner"
            role="alertdialog"
          >
            <p>
              {{
                academicT("deleteStageConfirm", {
                  title:
                    stages.find((s) => s.id === deletingStageId)?.title ?? ""
                })
              }}
            </p>
            <div class="academic-inline-actions">
              <button
                type="button"
                class="academic-secondary-btn"
                :disabled="locked"
                @click="deletingStageId = null"
              >
                {{ academicT("cancel") }}
              </button>
              <button
                type="button"
                class="academic-danger-btn"
                :disabled="locked"
                @click="confirmDeleteStage"
              >
                {{ academicT("delete") }}
              </button>
            </div>
          </div>

          <ol class="academic-stage-list">
            <li
              v-for="(stage, index) in stages"
              :key="stage.id"
              class="academic-stage-item"
              :class="{ 'is-disabled': !stage.enabled }"
            >
              <div class="academic-stage-main">
                <div class="academic-stage-title-row">
                  <strong>{{ stage.title }}</strong>
                  <span class="academic-stage-badge">
                    {{
                      isBuiltinAcademicFrameworkStageId(stage.id)
                        ? academicT("builtinStage")
                        : academicT("customStage")
                    }}
                  </span>
                </div>
                <p>{{ stage.description }}</p>
              </div>
              <div class="academic-stage-controls">
                <button
                  type="button"
                  role="switch"
                  class="academic-switch-btn"
                  :class="{ 'is-on': stage.enabled }"
                  :aria-checked="stage.enabled"
                  :disabled="locked"
                  @click="toggleStageEnabled(stage.id, !stage.enabled)"
                >
                  {{
                    stage.enabled
                      ? academicT("enabledLabel")
                      : academicT("disabledLabel")
                  }}
                </button>
                <button
                  type="button"
                  class="academic-icon-btn"
                  :disabled="locked || index === 0"
                  :aria-label="academicTreeT('moveUp')"
                  @click="moveStage(stage.id, 'up')"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="academic-icon-btn"
                  :disabled="locked || index === stages.length - 1"
                  :aria-label="academicTreeT('moveDown')"
                  @click="moveStage(stage.id, 'down')"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="academic-secondary-btn"
                  :disabled="locked"
                  @click="openEditStage(stage.id)"
                >
                  {{ academicT("editStage") }}
                </button>
                <button
                  v-if="!isBuiltinAcademicFrameworkStageId(stage.id)"
                  type="button"
                  class="academic-danger-btn"
                  :disabled="locked"
                  @click="requestDeleteStage(stage.id)"
                >
                  {{ academicT("delete") }}
                </button>
              </div>
            </li>
          </ol>
        </template>

        <template v-else-if="activeTab === 'settings'">
          <div class="academic-settings-panel">
            <label class="academic-field">
              <span>{{ academicT("subtypeLabel") }}</span>
              <PopupSelect
                :model-value="draftSubtype"
                :options="subtypeOptions"
                :accessible-label="academicT('subtypeLabel')"
                :disabled="locked"
                :menu-z-index="2300"
                @update:model-value="updateSubtype"
              />
              <small>{{ academicSubtypeDescription(draftSubtype) }}</small>
            </label>

            <label class="academic-field">
              <span>{{ academicT("citationStyleLabel") }}</span>
              <PopupSelect
                :model-value="draftCitationStyle"
                :options="citationStyleOptions"
                :accessible-label="academicT('citationStyleLabel')"
                :disabled="locked"
                :menu-z-index="2300"
                @update:model-value="updateCitationStyle"
              />
              <small>{{
                academicCitationStyleDescription(draftCitationStyle)
              }}</small>
            </label>

            <div class="academic-inline-actions">
              <button
                type="button"
                class="academic-primary-btn"
                :disabled="locked || !settingsDirty"
                @click="saveBookSettings"
              >
                {{ locked ? academicT("saving") : academicT("save") }}
              </button>
            </div>
          </div>
        </template>

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
      </div>
    </section>
  </div>
</template>

<style scoped>
.academic-dialog-backdrop {
  z-index: 2100;
}

.academic-framework-dialog {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.academic-framework-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-dialog-eyebrow {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.academic-framework-header h2 {
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

.academic-dialog-close:hover:not(:disabled) {
  background: var(--surface-muted);
  color: var(--text-primary);
}

.academic-framework-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 22px;
  background: var(--surface-muted);
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-framework-tab {
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.academic-framework-tab.is-active {
  background: var(--surface-raised);
  border-color: var(--theme-line-soft);
  color: var(--text-primary);
  font-weight: 500;
}

.academic-framework-body {
  padding: 18px 22px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.academic-framework-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.academic-framework-intro p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.academic-stage-form,
.academic-confirm-banner,
.academic-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: var(--surface-muted);
  border: 1px solid var(--theme-line-soft);
}

.academic-stage-form h3 {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.academic-confirm-banner p {
  margin: 0;
  font-size: 0.8125rem;
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

.academic-field input,
.academic-field textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.academic-field small {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.academic-stage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.academic-stage-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.academic-stage-item.is-disabled {
  opacity: 0.65;
}

.academic-stage-main {
  flex: 1;
  min-width: 0;
}

.academic-stage-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.academic-stage-title-row strong {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.academic-stage-badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  background: var(--surface-muted);
}

.academic-stage-main p {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.academic-stage-controls,
.academic-inline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.academic-switch-btn,
.academic-secondary-btn,
.academic-primary-btn,
.academic-danger-btn,
.academic-icon-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
}

.academic-icon-btn {
  width: 28px;
  padding: 0;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.academic-switch-btn {
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.academic-switch-btn.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
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
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  color: var(--danger, #c93b3b);
}

.academic-switch-btn:disabled,
.academic-secondary-btn:disabled,
.academic-primary-btn:disabled,
.academic-danger-btn:disabled,
.academic-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
