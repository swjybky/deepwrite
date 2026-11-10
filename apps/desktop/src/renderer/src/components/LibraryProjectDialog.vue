<script setup lang="ts">
import type {
  MaterialKind,
  MaterialStageId,
  SkillKind
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import {
  useLibraryProjectDialog,
  type LibraryProjectDialogProps,
  type LibraryProjectDialogEvents
} from "../composables/useLibraryProjectDialog";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.libraryProjectDialog");
const props = defineProps<LibraryProjectDialogProps>();
const emit = defineEmits<LibraryProjectDialogEvents>();
const {
  destination,
  entryDestinations,
  title,
  stageId,
  libraryKind,
  titleInput,
  domainLabel,
  heading,
  libraryKindOptions,
  stageOptions,
  showEntryStageField,
  requestClose,
  submit
} = useLibraryProjectDialog(props, emit);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog library-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-project-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              t("libraryLocalFolderProjectMessage", { arg0: domainLabel ?? "" })
            }}</span>
            <h2 id="library-project-dialog-title">{{ heading }}</h2>
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

        <form
          class="dialog-content catalog-resource-form"
          @submit.prevent="submit"
        >
          <template v-if="operation === 'create-library'">
            <p class="dialog-description">
              {{ t("newLibrariesAreSavedAutomaticallyInTheCurrentWorkspace") }}
            </p>
            <label class="book-resource-name-field">
              <span>{{
                t("libraryNameMessage", {
                  arg0: domainLabel ?? ""
                })
              }}</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                maxlength="80"
                autocomplete="off"
                :placeholder="
                  t('enterAValueLibraryName', {
                    arg0: domainLabel
                  })
                "
                :disabled="submitting"
              />
            </label>
            <p class="book-resource-help">
              {{ t("thisLibraryIsSharedAcrossShortStoriesScreenplaysAnd") }}
            </p>
            <label
              class="book-resource-name-field catalog-resource-stage-field"
            >
              <span>{{
                t("libraryCategoryMessage", {
                  arg0: domainLabel ?? ""
                })
              }}</span>
              <PopupSelect
                :model-value="libraryKind"
                :options="libraryKindOptions"
                :accessible-label="
                  t('valueLibraryCategory', {
                    arg0: domainLabel
                  })
                "
                size="large"
                :disabled="submitting"
                :menu-min-width="220"
                @update:model-value="
                  libraryKind = String($event) as MaterialKind | SkillKind
                "
              />
            </label>
            <p class="book-resource-help">
              {{ t("theFolderContainsDeepwriteJsonWithEntriesInEntries") }}
            </p>
          </template>

          <template
            v-else-if="
              operation === 'create-entry' ||
              operation === 'rename-library' ||
              operation === 'rename-entry'
            "
          >
            <p class="dialog-description">
              {{
                operation === "create-entry"
                  ? t("newEntriesAreImmediatelyCreatedAsMarkdownFilesIn")
                  : t("theNewNameIsSavedImmediatelyToTheLocal")
              }}
            </p>
            <label class="book-resource-name-field">
              <span>{{
                operation === "rename-library"
                  ? t("valueLibraryName", {
                      arg0: domainLabel
                    })
                  : t("entryName")
              }}</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                maxlength="80"
                autocomplete="off"
                :placeholder="
                  operation === 'rename-library'
                    ? t('enterAValueLibraryName', { arg0: domainLabel })
                    : t('enterAnEntryName')
                "
                :disabled="submitting"
              />
            </label>
            <template v-if="operation === 'create-entry' && !libraryId">
              <label class="book-resource-name-field">
                <span>{{ t("destinationLibrary") }}</span>
                <PopupSelect
                  v-model="destination"
                  :options="entryDestinations"
                  :accessible-label="t('destinationLibrary')"
                  size="large"
                  :disabled="submitting"
                />
              </label>
              <label
                v-if="domain === 'skill' && !destination"
                class="book-resource-name-field"
              >
                <span>{{
                  t("libraryCategoryMessage", { arg0: domainLabel })
                }}</span>
                <PopupSelect
                  v-model="libraryKind"
                  :options="libraryKindOptions"
                  size="large"
                  :disabled="submitting"
                  :accessible-label="
                    t('valueLibraryCategory', { arg0: domainLabel })
                  "
                />
              </label>
            </template>
            <label
              v-if="showEntryStageField"
              class="book-resource-name-field catalog-resource-stage-field"
            >
              <span>{{ t("contentStage") }}</span>
              <PopupSelect
                :model-value="stageId"
                :options="stageOptions"
                :accessible-label="t('contentStage')"
                size="large"
                :disabled="submitting"
                :menu-min-width="220"
                @update:model-value="
                  stageId = String($event) as MaterialStageId
                "
              />
            </label>
          </template>

          <div v-else class="catalog-resource-warning">
            <AppIcon name="trash" :size="20" />
            <div>
              <strong>{{
                t("thisDeletesTheCorrespondingMarkdownFile")
              }}</strong>
              <p>
                {{
                  t("willBeDeletedFromAndFromDiskMessage", {
                    arg0: entryTitle ?? "",
                    arg1: libraryTitle ?? ""
                  })
                }}
              </p>
            </div>
          </div>

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
              :class="{ 'is-danger': operation === 'remove-entry' }"
              type="submit"
              :disabled="submitting"
            >
              {{
                submitting
                  ? t("processing")
                  : operation === "create-library"
                    ? t("createValueLibrary", {
                        arg0: domainLabel
                      })
                    : operation === "create-entry"
                      ? t("createEntry")
                      : operation === "rename-library" ||
                          operation === "rename-entry"
                        ? t("saveName")
                        : t("delete")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./library-project-dialog.css"></style>
