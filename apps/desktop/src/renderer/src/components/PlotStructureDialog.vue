<script setup lang="ts">
import { plotStageLabel } from "../i18n/plotStageLabels";
import { createScopedTranslator } from "../i18n";
import { type Book } from "@deepwrite/contracts/renderer";
import AppIcon from "./AppIcon.vue";
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
  closeButton,
  confirmCharacterFormat,
  confirmDelete,
  deletingHasContent,
  deletingStage,
  dialogElement,
  form,
  formMode,
  isBuiltinCreativePlotStageId,
  locked,
  move,
  openCreate,
  openDelete,
  openEdit,
  orderedCharacterItems,
  requestedCharacterFormat,
  rows,
  saveWritingContext,
  selectCharacterFormat,
  setActiveStructureTab,
  submitForm,
  toggleEnabled,
  writingContextPanel
} = usePlotStructureDialog(props, emit);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && book && book.bookType !== 'academic' && !activeSubdialog"
      class="dialog-backdrop plot-structure-dialog-overlay"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="plot-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plot-structure-title"
        tabindex="-1"
      >
        <header class="plot-structure-dialog-header">
          <div>
            <span>{{
              t("settingsMessage", {
                arg0:
                  (book.bookType === "script"
                    ? t("screenplay")
                    : t("shortStory")) ?? ""
              })
            }}</span>
            <strong id="plot-structure-title">{{
              t("structureManagementMessage", {
                arg0: book.title ?? ""
              })
            }}</strong>
          </div>
          <button
            ref="closeButton"
            type="button"
            :aria-label="t('closeStructureManagement')"
            :disabled="locked"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <section
          class="plot-structure-manager"
          :aria-label="t('manageStructure')"
        >
          <div
            class="structure-main-tabs"
            role="tablist"
            :aria-label="t('structureManagementType')"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'character'"
              @click="setActiveStructureTab('character')"
            >
              {{ t("characterStructure") }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'plot'"
              @click="setActiveStructureTab('plot')"
            >
              {{ t("plotStructure") }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'context'"
              @click="setActiveStructureTab('context')"
            >
              {{
                book.bookType === "script"
                  ? t("screenplayContext")
                  : t("shortStoryContext")
              }}
            </button>
          </div>

          <template v-if="activeStructureTab === 'character'">
            <header class="manager-header">
              <div>
                <p class="manager-eyebrow">CHARACTER STRUCTURE</p>
                <h2>
                  {{ t("characterStructure") }}
                </h2>
                <p>
                  {{
                    t("chooseContinuousCharacterTextOrAnOverviewWithIndividual")
                  }}
                </p>
              </div>
            </header>
            <div class="structure-panel-content character-structure-panel">
              <label class="form-field">
                <span>{{ t("characterStyle") }}</span>
                <PopupSelect
                  :model-value="book.characterStructure.format"
                  :options="[
                    {
                      value: 'list',
                      label: t('entryStyle')
                    },
                    {
                      value: 'text',
                      label: t('textStyle')
                    }
                  ]"
                  :accessible-label="t('characterStructureStyle')"
                  :disabled="locked"
                  :menu-z-index="2300"
                  @update:model-value="selectCharacterFormat"
                />
                <small v-if="book.characterStructure.format === 'list'">
                  {{ t("charactersAppearAsAnOverviewAndSeparateEntriesIn") }}
                </small>
                <small v-else>
                  {{ t("charactersContinueToUseASingleMarkdownDocument") }}
                </small>
              </label>
            </div>
          </template>

          <template v-else-if="activeStructureTab === 'plot'">
            <header class="manager-header">
              <div>
                <p class="manager-eyebrow">CREATIVE PLOT STRUCTURE</p>
                <h2>{{ t("plotStructure") }}</h2>
                <p>
                  {{ t("namesAndNotesApplyGloballyEnabledStateAndOrder") }}
                </p>
              </div>
            </header>

            <div class="structure-panel-content">
              <header class="manager-toolbar">
                <div
                  class="section-tabs"
                  role="tablist"
                  :aria-label="t('basicStructureType')"
                >
                  <button type="button" role="tab" aria-selected="true">
                    {{ t("plotStructureLabel") }}
                  </button>
                </div>
                <button
                  class="primary-button"
                  type="button"
                  :disabled="locked || rows.length >= 32"
                  @click="openCreate"
                >
                  {{ t("newPlotStructure") }}
                </button>
              </header>

              <ol class="manager-list">
                <li
                  v-for="(stage, index) in rows"
                  :key="stage.id"
                  class="manager-row"
                  :class="{ 'is-disabled': !stage.enabled }"
                >
                  <label class="row-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      :checked="stage.enabled"
                      :disabled="locked"
                      :aria-label="
                        t('stageToggleLabel', {
                          action: stage.enabled
                            ? t('disableStage')
                            : t('enable'),
                          name: plotStageLabel(stage)
                        })
                      "
                      @change="
                        toggleEnabled(
                          stage.id,
                          ($event.target as HTMLInputElement).checked
                        )
                      "
                    />
                    <span>{{ stage.enabled ? t("enable") : t("off") }}</span>
                  </label>
                  <div class="row-copy">
                    <strong>{{ plotStageLabel(stage) }}</strong>
                    <span>{{ stage.description }}</span>
                    <code>
                      {{ stage.id }}
                      <template v-if="isBuiltinCreativePlotStageId(stage.id)">
                        {{ t("default") }}
                      </template>
                    </code>
                  </div>
                  <div class="row-actions">
                    <button
                      type="button"
                      :aria-label="
                        t('moveValueUp', {
                          arg0: plotStageLabel(stage)
                        })
                      "
                      :title="t('moveUp')"
                      :disabled="locked || index === 0"
                      @click="move(stage.id, 'up')"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      :aria-label="
                        t('moveValueDown', {
                          arg0: plotStageLabel(stage)
                        })
                      "
                      :title="t('moveDown')"
                      :disabled="locked || index === rows.length - 1"
                      @click="move(stage.id, 'down')"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      :aria-label="
                        t('editValue', {
                          arg0: plotStageLabel(stage)
                        })
                      "
                      :disabled="locked"
                      @click="openEdit(stage.id)"
                    >
                      {{ t("edit") }}
                    </button>
                    <button
                      class="delete-button"
                      type="button"
                      :aria-label="
                        t('deleteValue', {
                          arg0: plotStageLabel(stage)
                        })
                      "
                      :disabled="
                        locked ||
                        rows.length <= 1 ||
                        isBuiltinCreativePlotStageId(stage.id)
                      "
                      @click="openDelete(stage.id)"
                    >
                      {{ t("delete") }}
                    </button>
                  </div>
                </li>
              </ol>

              <p class="manager-footnote">
                {{ t("newStagesApplyToAllShortStoriesAndScreenplays") }}
              </p>
            </div>
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
        </section>
      </section>
    </div>

    <div
      v-if="open && book && activeSubdialog === 'character-format'"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="requestedCharacterFormat = null"
      @keydown.esc.stop="requestedCharacterFormat = null"
    >
      <section
        class="structure-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="character-format-title"
      >
        <header class="modal-header">
          <div>
            <span>CONVERT</span>
            <h3 id="character-format-title">
              {{ t("convertCharacterStructure") }}
            </h3>
          </div>
        </header>
        <fieldset class="modal-body" :disabled="locked">
          <p class="delete-copy">
            <template v-if="requestedCharacterFormat === 'list'">
              {{ t("currentCharacterTextMovesInFullToACharacter") }}
            </template>
            <template v-else>
              {{ t("theOverviewAndAllCharacterEntriesMergeIntoOne") }}
            </template>
          </p>
          <div class="character-conversion-preview">
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
        </fieldset>
        <footer class="modal-actions">
          <button
            type="button"
            :disabled="locked"
            @click="requestedCharacterFormat = null"
          >
            {{ t("cancel") }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="locked"
            @click="confirmCharacterFormat"
          >
            {{ locked ? t("converting") : t("convert") }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-else-if="open && book && activeSubdialog === 'form'"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="close"
      @keydown.esc.stop="close"
    >
      <section
        class="structure-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="
          formMode === 'create' ? t('newPlotStructure') : t('editPlotStructure')
        "
      >
        <form @submit.prevent="submitForm">
          <header class="modal-header">
            <div>
              <span>{{ formMode === "create" ? "CREATE" : "EDIT" }}</span>
              <h3>
                {{
                  formMode === "create"
                    ? t("newPlotStructure")
                    : t("editPlotStructure")
                }}
              </h3>
            </div>
            <button
              class="close-button"
              type="button"
              :aria-label="t('close')"
              :disabled="locked"
              @click="close"
            >
              ×
            </button>
          </header>

          <fieldset class="modal-body" :disabled="locked">
            <label class="form-field">
              <span>{{ t("name") }}</span>
              <input
                v-model="form.title"
                maxlength="120"
                autocomplete="off"
                autofocus
                required
              />
            </label>
            <label class="form-field">
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
            <p class="stable-id-note">
              {{ t("theStableIDRemainsUnchangedAfterRenamingOrReordering") }}
            </p>
          </fieldset>

          <footer class="modal-actions">
            <button type="button" :disabled="locked" @click="close">
              {{ t("cancel") }}
            </button>
            <button class="primary-button" type="submit" :disabled="locked">
              {{
                locked
                  ? t("saving")
                  : formMode === "create"
                    ? t("create")
                    : t("saveChanges")
              }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-else-if="open && book && activeSubdialog === 'delete' && deletingStage"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="close"
      @keydown.esc.stop="close"
    >
      <section
        class="structure-modal delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="plot-structure-delete-title"
        aria-describedby="plot-structure-delete-description"
      >
        <header class="modal-header">
          <div>
            <span>DELETE</span>
            <h3 id="plot-structure-delete-title">
              {{
                t("deleteMessage", {
                  arg0: plotStageLabel(deletingStage) ?? ""
                })
              }}
            </h3>
          </div>
        </header>
        <fieldset class="modal-body" :disabled="locked">
          <p id="plot-structure-delete-description" class="delete-copy">
            {{
              t("thisCustomStageAppliesToAllShortMessage", {
                arg0:
                  (deletingHasContent
                    ? t("thisStageAlreadyHasContentInTheCurrentWork")
                    : "") ?? ""
              })
            }}
          </p>
        </fieldset>
        <footer class="modal-actions">
          <button type="button" :disabled="locked" autofocus @click="close">
            {{ t("cancel") }}
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="locked"
            @click="confirmDelete"
          >
            {{ locked ? t("deleting") : t("deleteGlobally") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./plot-structure-dialog.css"></style>
