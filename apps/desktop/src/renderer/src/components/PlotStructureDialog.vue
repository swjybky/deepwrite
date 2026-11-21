<script setup lang="ts">
import { computed } from "vue";
import { useRowOrderDrag } from "../composables/useRowOrderDrag";
import { plotStageLabel } from "../i18n/plotStageLabels";
import { createScopedTranslator } from "../i18n";
import { type Book } from "@deepwrite/contracts/renderer";
import BookManagementRowActions from "./book-management/BookManagementRowActions.vue";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import BookManagementChildDialog from "./book-management/BookManagementChildDialog.vue";
import BookManagementDialog, {
  type BookManagementSection
} from "./book-management/BookManagementDialog.vue";
import PopupSelect from "./PopupSelect.vue";
import WritingContextPanel from "./WritingContextPanel.vue";
import {
  usePlotStructureDialog,
  type PlotStructureDialogEmit
} from "./usePlotStructureDialog";

const t = createScopedTranslator("components.plotStructureDialog");

const props = withDefaults(
  defineProps<{
    open: boolean;
    childOpen?: boolean;
    book: Book | null;
    pending?: boolean;
    writingContext?: string | null;
    writingContextLoading?: boolean;
    writingContextPending?: boolean;
  }>(),
  {
    pending: false,
    writingContext: null,
    writingContextLoading: false,
    writingContextPending: false
  }
);

const emit = defineEmits<PlotStructureDialogEmit>();

const {
  activeStructureTab,
  activeSubdialog,
  characterOverview,
  characterTextPreview,
  close,
  confirmCharacterFormat,
  confirmDelete,
  deletingHasContent,
  deletingStage,
  form,
  formMode,
  flushWritingContext,
  isBuiltinCreativePlotStageId,
  locked,
  move,
  openCreate,
  openDelete,
  openEdit,
  orderedCharacterItems,
  reorder,
  requestedCharacterFormat,
  rows,
  saveWritingContext,
  selectCharacterFormat,
  setActiveStructureTab,
  submitForm,
  toggleEnabled,
  writingContextPanel
} = usePlotStructureDialog(props, emit);
const canReorderStages = computed(
  () =>
    !locked.value &&
    !props.childOpen &&
    !activeSubdialog.value &&
    rows.value.length > 1
);
const stageOrderDrag = useRowOrderDrag<string>(
  "data-plot-stage-id",
  "button, input",
  (stageId) => {
    if (!canReorderStages.value) return;
    const currentRows = rows.value;
    const sourceIndex = currentRows.findIndex((stage) => stage.id === stageId);
    if (sourceIndex < 0) return;
    return {
      findTarget: (id) =>
        canReorderStages.value &&
        rows.value === currentRows &&
        id !== stageId &&
        currentRows.some((stage) => stage.id === id)
          ? id
          : undefined,
      canDrop: (anchorId, position) => {
        const targetIndex = currentRows.findIndex(
          (stage) => stage.id === anchorId
        );
        return !(
          targetIndex < 0 ||
          (position === "before" && sourceIndex + 1 === targetIndex) ||
          (position === "after" && targetIndex + 1 === sourceIndex)
        );
      },
      drop: (anchorId, position) => {
        reorder(stageId, anchorId, position);
      }
    };
  }
);
const contextT = createScopedTranslator("components.writingContextPanel");
const sections = computed<
  BookManagementSection<typeof activeStructureTab.value>[]
>(() => [
  {
    id: "character",
    group: "structure",
    label: t("characterStructure"),
    description: t("chooseContinuousCharacterTextOrAnOverviewWithIndividual")
  },
  {
    id: "plot",
    group: "structure",
    label: t("plotStructureLabel"),
    description: t("namesAndNotesApplyGloballyEnabledStateAndOrder")
  },
  {
    id: "context",
    group: "context",
    label: contextT(
      props.book?.bookType === "script"
        ? "screenplayContext"
        : "shortStoryContext"
    ),
    description: contextT(
      "storeLastingCreativeMethodsAndConstraintsForThisWork"
    )
  }
]);

async function openRename(): Promise<void> {
  const book = props.book;
  if (!book || locked.value || !(await flushWritingContext())) return;
  emit("openRename", book.id);
}
</script>

<template>
  <BookManagementDialog
    v-if="book && book.bookType !== 'academic'"
    :open="open"
    :book-title="book.title"
    :book-type="t(book.bookType === 'script' ? 'screenplay' : 'shortStory')"
    :sections="sections"
    :active="activeStructureTab"
    :pending="locked"
    :child-open="childOpen || Boolean(activeSubdialog)"
    @close="close"
    @rename="openRename"
    @select="setActiveStructureTab"
  >
    <template #actions>
      <button
        v-if="activeStructureTab === 'plot'"
        class="dialog-primary-button"
        type="button"
        :disabled="locked || rows.length >= 32"
        @click="openCreate"
      >
        {{ t("newPlotStructure") }}
      </button>
    </template>

    <div
      v-if="activeStructureTab === 'character'"
      class="book-management-settings"
    >
      <div class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ t("characterStyle") }}</strong>
          <span>{{
            book.characterStructure.format === "list"
              ? t("charactersAppearAsAnOverviewAndSeparateEntriesIn")
              : t("charactersContinueToUseASingleMarkdownDocument")
          }}</span>
        </div>
        <PopupSelect
          :model-value="book.characterStructure.format"
          :options="[
            { value: 'list', label: t('entryStyle') },
            { value: 'text', label: t('textStyle') }
          ]"
          :accessible-label="t('characterStructureStyle')"
          :disabled="locked"
          :menu-z-index="2300"
          @update:model-value="selectCharacterFormat"
        />
      </div>
    </div>
    <template v-else-if="activeStructureTab === 'plot'">
      <ol
        class="book-management-list"
        :class="{ 'plot-stages-reorderable': canReorderStages }"
        @pointerdown="stageOrderDrag.start"
        @click.capture="stageOrderDrag.click"
      >
        <li
          v-for="(stage, index) in rows"
          :key="stage.id"
          class="book-management-row plot-structure-stage"
          :data-plot-stage-id="stage.id"
        >
          <AgentTeamSwitch
            :model-value="stage.enabled"
            :disabled="locked"
            :label="
              t('stageToggleLabel', {
                action: stage.enabled ? t('disableStage') : t('enable'),
                name: plotStageLabel(stage)
              })
            "
            @update:model-value="toggleEnabled(stage.id, $event)"
          />
          <div class="book-management-copy">
            <strong :title="plotStageLabel(stage)">{{
              plotStageLabel(stage)
            }}</strong>
            <span>{{ stage.description }}</span>
            <div class="book-management-meta">
              <code :title="stage.id">{{ stage.id }}</code>
              <span
                v-if="isBuiltinCreativePlotStageId(stage.id)"
                class="book-management-label"
              >
                {{ t("default") }}
              </span>
            </div>
          </div>
          <BookManagementRowActions
            :title="plotStageLabel(stage)"
            :pending="locked"
            :up-disabled="index === 0"
            :down-disabled="index === rows.length - 1"
            :delete-disabled="
              rows.length <= 1 || isBuiltinCreativePlotStageId(stage.id)
            "
            @move="move(stage.id, $event)"
            @edit="openEdit(stage.id)"
            @delete="openDelete(stage.id)"
          />
        </li>
      </ol>

      <p class="book-management-note">
        {{ t("newStagesApplyToAllShortStoriesAndScreenplays") }}
      </p>
    </template>
    <WritingContextPanel
      v-else
      :key="book.id"
      ref="writingContextPanel"
      :content="writingContext"
      :loading="writingContextLoading"
      :pending="writingContextPending"
      :workspace-type="book.bookType"
      @save="saveWritingContext"
    />

    <BookManagementChildDialog
      v-if="activeSubdialog === 'character-format'"
      :title="t('convertCharacterStructure')"
      :pending="locked"
      confirm
      @close="requestedCharacterFormat = null"
      @submit="confirmCharacterFormat"
    >
      <p class="dialog-description">
        <template v-if="requestedCharacterFormat === 'list'">
          {{ t("currentCharacterTextMovesInFullToACharacter") }}
        </template>
        <template v-else>
          {{ t("theOverviewAndAllCharacterEntriesMergeIntoOne") }}
        </template>
      </p>
      <div class="dialog-note book-management-conversion-preview">
        <strong>{{ t("conversionPreview") }}</strong>
        <template v-if="requestedCharacterFormat === 'list'">
          <span>{{
            characterOverview?.content.trim()
              ? t("characterProfiles1Entry")
              : t("overviewEmptyEntryList")
          }}</span>
          <pre>{{ characterTextPreview }}</pre>
        </template>
        <template v-else>
          <span>
            {{
              t("overviewFollowedByCharacterEntriesMessage", {
                arg0:
                  (characterOverview?.content.trim()
                    ? t("hasContent")
                    : t("empty")) ?? "",
                arg1: orderedCharacterItems.length ?? ""
              })
            }}
          </span>
          <ol v-if="orderedCharacterItems.length">
            <li v-for="item in orderedCharacterItems" :key="item.id">
              {{ item.title }}
            </li>
          </ol>
          <span v-else>{{ t("noCharacterEntriesYet") }}</span>
        </template>
      </div>
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="locked"
          autofocus
          @click="requestedCharacterFormat = null"
        >
          {{ t("cancel") }}
        </button>
        <button class="dialog-primary-button" type="submit" :disabled="locked">
          {{ locked ? t("converting") : t("convert") }}
        </button>
      </template>
    </BookManagementChildDialog>

    <BookManagementChildDialog
      v-else-if="activeSubdialog === 'form'"
      :title="
        formMode === 'create' ? t('newPlotStructure') : t('editPlotStructure')
      "
      :pending="locked"
      @close="close"
      @submit="submitForm"
    >
      <label class="book-management-field">
        <span>{{ t("name") }}</span>
        <input
          v-model="form.title"
          maxlength="120"
          autocomplete="off"
          autofocus
          required
        />
      </label>
      <label class="book-management-field">
        <span>{{ t("structureNotes") }}</span>
        <textarea
          v-model="form.description"
          maxlength="20000"
          rows="7"
          required
        />
        <small>{{
          t("theseNotesDefineThePlotAgentSResponsibilitiesAnd")
        }}</small>
      </label>
      <p class="book-management-note">
        {{ t("theStableIDRemainsUnchangedAfterRenamingOrReordering") }}
      </p>
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="locked"
          @click="close"
        >
          {{ t("cancel") }}
        </button>
        <button class="dialog-primary-button" type="submit" :disabled="locked">
          {{
            locked
              ? t("saving")
              : formMode === "create"
                ? t("create")
                : t("saveChanges")
          }}
        </button>
      </template>
    </BookManagementChildDialog>

    <BookManagementChildDialog
      v-else-if="activeSubdialog === 'delete' && deletingStage"
      :title="t('deleteMessage', { arg0: plotStageLabel(deletingStage) })"
      :pending="locked"
      confirm
      @close="close"
      @submit="confirmDelete"
    >
      <p class="dialog-description">
        {{
          t("thisCustomStageAppliesToAllShortMessage", {
            arg0: deletingHasContent
              ? t("thisStageAlreadyHasContentInTheCurrentWork")
              : ""
          })
        }}
      </p>
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="locked"
          autofocus
          @click="close"
        >
          {{ t("cancel") }}
        </button>
        <button
          class="dialog-primary-button is-danger"
          type="submit"
          :disabled="locked"
        >
          {{ locked ? t("deleting") : t("deleteGlobally") }}
        </button>
      </template>
    </BookManagementChildDialog>
    <slot name="child" />
  </BookManagementDialog>
</template>

<style scoped>
.plot-stages-reorderable .plot-structure-stage {
  cursor: grab;
  user-select: none;
}
.book-management-conversion-preview {
  display: grid;
  gap: 6px;
}
.book-management-conversion-preview pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
