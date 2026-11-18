<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  AcademicManuscriptExportFormat,
  AcademicManuscriptImageMode
} from "@deepwrite/contracts/renderer";
import AppIcon from "../AppIcon.vue";
import { academicT } from "./academicLabels";
import {
  executeExportAcademicManuscript,
  resolveAcademicExportSourceBook
} from "../../composables/useAcademicBookLifecycleCoordinator";
import { useCatalogIndexStore } from "../../stores/catalogIndexStore";
import {
  academicExportPending,
  getAcademicLifecyclePort
} from "../../stores/academicWorkspaceDialog";
import {
  listAcademicManuscriptExportTree,
  type AcademicManuscriptExportChapterGroup
} from "../../utils/academicManuscriptExport";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  bookId: string;
  bookTitle?: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

const catalogIndexStore = useCatalogIndexStore();
const submitting = computed(() => academicExportPending.value);

const sourceBook = computed(() =>
  resolveAcademicExportSourceBook(props.bookId)
);
const displayBookTitle = computed(
  () => sourceBook.value?.title ?? props.bookTitle ?? ""
);

const exportTree = computed(() => {
  const book = sourceBook.value;
  if (!book) {
    return {
      hasChapters: false,
      leadingSections: [],
      chapters: [],
      trailingSections: [],
      orderedSections: [],
      defaultSelectedSectionIds: []
    };
  }
  const port = getAcademicLifecyclePort();
  const docs = port?.documents?.value ?? catalogIndexStore.workspaceDocuments;
  const drafts = port?.drafts?.value ?? {};
  return listAcademicManuscriptExportTree(book, docs, drafts);
});

const selectedSectionIds = ref<string[]>([]);
const includeChapterHeadings = ref(true);
const selectedFormat = ref<AcademicManuscriptExportFormat>("docx");
const selectedImageMode = ref<AcademicManuscriptImageMode>("assets_folder");

watch(
  () => props.bookId,
  () => {
    selectedSectionIds.value = [...exportTree.value.defaultSelectedSectionIds];
    includeChapterHeadings.value = true;
    selectedFormat.value = "docx";
    selectedImageMode.value = "assets_folder";
  },
  { immediate: true }
);

const selectedSet = computed(() => new Set(selectedSectionIds.value));
const totalSectionCount = computed(
  () => exportTree.value.orderedSections.length
);
const canSubmit = computed(
  () => !submitting.value && selectedSectionIds.value.length > 0
);

function toggleSection(sectionId: string): void {
  if (submitting.value) return;
  const next = new Set(selectedSectionIds.value);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  selectedSectionIds.value = exportTree.value.orderedSections
    .filter((item) => next.has(item.id))
    .map((item) => item.id);
}

function isChapterAllChecked(
  chapter: AcademicManuscriptExportChapterGroup
): boolean {
  return (
    chapter.sections.length > 0 &&
    chapter.sections.every((section) => selectedSet.value.has(section.id))
  );
}

function isChapterIndeterminate(
  chapter: AcademicManuscriptExportChapterGroup
): boolean {
  const checkedCount = chapter.sections.filter((section) =>
    selectedSet.value.has(section.id)
  ).length;
  return checkedCount > 0 && checkedCount < chapter.sections.length;
}

function toggleChapter(chapter: AcademicManuscriptExportChapterGroup): void {
  if (submitting.value || chapter.sections.length === 0) return;
  const allChecked = isChapterAllChecked(chapter);
  const next = new Set(selectedSectionIds.value);
  for (const section of chapter.sections) {
    if (allChecked) next.delete(section.id);
    else next.add(section.id);
  }
  selectedSectionIds.value = exportTree.value.orderedSections
    .filter((item) => next.has(item.id))
    .map((item) => item.id);
}

function selectNonEmpty(): void {
  if (submitting.value) return;
  selectedSectionIds.value = [...exportTree.value.defaultSelectedSectionIds];
}

function selectAll(): void {
  if (submitting.value) return;
  selectedSectionIds.value = exportTree.value.orderedSections.map(
    (item) => item.id
  );
}

function clearSelection(): void {
  if (submitting.value) return;
  selectedSectionIds.value = [];
}

function requestClose(): void {
  if (!submitting.value) emit("close");
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (selectedSectionIds.value.length === 0) {
    uiMessage.warning(academicT("exportSelectAtLeastOneSection"));
    return;
  }
  const ok = await executeExportAcademicManuscript(props.bookId, {
    sectionIds: [...selectedSectionIds.value],
    includeChapterHeadings: includeChapterHeadings.value,
    format: selectedFormat.value,
    imageMode: selectedImageMode.value
  });
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
    class="dialog-backdrop acad-export-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      class="acad-export-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acad-export-dialog-title"
    >
      <header class="acad-export-header">
        <div>
          <span class="acad-export-eyebrow">{{ displayBookTitle }}</span>
          <h2 id="acad-export-dialog-title">
            {{ academicT("exportDialogTitle") }}
          </h2>
        </div>
        <button
          class="dialog-close"
          type="button"
          :aria-label="academicT('close')"
          :disabled="submitting"
          @click="requestClose"
        >
          ×
        </button>
      </header>

      <form class="acad-export-body" @submit.prevent="submit">
        <div class="acad-export-notice" role="note">
          <span class="acad-export-notice-icon">
            <AppIcon name="download" :size="17" />
          </span>
          <p>{{ academicT("exportScopeNote") }}</p>
        </div>

        <fieldset class="acad-export-fieldset">
          <div class="acad-export-section-head">
            <legend>{{ academicT("exportSectionsLegend") }}</legend>
            <div class="acad-export-quick-actions">
              <span class="acad-export-count-badge">
                {{
                  academicT("exportSelectedCount", {
                    selected: selectedSectionIds.length,
                    total: totalSectionCount
                  })
                }}
              </span>
              <button
                type="button"
                class="acad-export-link-btn"
                :disabled="submitting"
                @click="selectNonEmpty"
              >
                {{ academicT("exportSelectNonEmpty") }}
              </button>
              <button
                type="button"
                class="acad-export-link-btn"
                :disabled="submitting"
                @click="selectAll"
              >
                {{ academicT("exportSelectAll") }}
              </button>
              <button
                type="button"
                class="acad-export-link-btn"
                :disabled="submitting"
                @click="clearSelection"
              >
                {{ academicT("exportClearAll") }}
              </button>
            </div>
          </div>

          <div class="acad-export-tree-scroll transient-scrollbar">
            <template v-if="exportTree.hasChapters">
              <label
                v-for="section in exportTree.leadingSections"
                :key="section.id"
                class="acad-export-item-row"
                :class="{ 'is-checked': selectedSet.has(section.id) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedSet.has(section.id)"
                  :disabled="submitting"
                  @change="toggleSection(section.id)"
                />
                <span class="acad-export-item-title">{{ section.title }}</span>
                <span v-if="!section.nonEmpty" class="acad-export-empty-pill">
                  {{ academicT("exportEmptyBadge") }}
                </span>
              </label>

              <div
                v-for="chapter in exportTree.chapters"
                :key="chapter.id"
                class="acad-export-chapter-group"
              >
                <label class="acad-export-chapter-row">
                  <input
                    type="checkbox"
                    :checked="isChapterAllChecked(chapter)"
                    :indeterminate.prop="isChapterIndeterminate(chapter)"
                    :disabled="submitting || chapter.sections.length === 0"
                    @change="toggleChapter(chapter)"
                  />
                  <AppIcon name="folder" :size="15" />
                  <span class="acad-export-chapter-title">
                    {{ chapter.title }}
                  </span>
                </label>
                <div
                  v-if="chapter.sections.length > 0"
                  class="acad-export-chapter-children"
                >
                  <label
                    v-for="section in chapter.sections"
                    :key="section.id"
                    class="acad-export-item-row is-nested"
                    :class="{ 'is-checked': selectedSet.has(section.id) }"
                  >
                    <input
                      type="checkbox"
                      :checked="selectedSet.has(section.id)"
                      :disabled="submitting"
                      @change="toggleSection(section.id)"
                    />
                    <span class="acad-export-item-title">
                      {{ section.title }}
                    </span>
                    <span
                      v-if="!section.nonEmpty"
                      class="acad-export-empty-pill"
                    >
                      {{ academicT("exportEmptyBadge") }}
                    </span>
                  </label>
                </div>
              </div>

              <label
                v-for="section in exportTree.trailingSections"
                :key="section.id"
                class="acad-export-item-row"
                :class="{ 'is-checked': selectedSet.has(section.id) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedSet.has(section.id)"
                  :disabled="submitting"
                  @change="toggleSection(section.id)"
                />
                <span class="acad-export-item-title">{{ section.title }}</span>
                <span v-if="!section.nonEmpty" class="acad-export-empty-pill">
                  {{ academicT("exportEmptyBadge") }}
                </span>
              </label>
            </template>

            <template v-else>
              <label
                v-for="section in exportTree.orderedSections"
                :key="section.id"
                class="acad-export-item-row"
                :class="{ 'is-checked': selectedSet.has(section.id) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedSet.has(section.id)"
                  :disabled="submitting"
                  @change="toggleSection(section.id)"
                />
                <span class="acad-export-item-title">{{ section.title }}</span>
                <span v-if="!section.nonEmpty" class="acad-export-empty-pill">
                  {{ academicT("exportEmptyBadge") }}
                </span>
              </label>
            </template>
          </div>

          <label
            v-if="exportTree.hasChapters"
            class="acad-export-hierarchy-toggle"
          >
            <input
              v-model="includeChapterHeadings"
              type="checkbox"
              :disabled="submitting"
            />
            <span class="acad-export-hierarchy-copy">
              <strong>{{ academicT("exportIncludeChapterHeadings") }}</strong>
              <small>{{ academicT("exportIncludeChapterHeadingsHint") }}</small>
            </span>
          </label>
        </fieldset>

        <fieldset class="acad-export-fieldset">
          <legend>{{ academicT("exportFormatLegend") }}</legend>
          <div class="acad-export-format-grid">
            <label
              class="acad-export-format-card"
              :class="{ 'is-selected': selectedFormat === 'docx' }"
            >
              <input
                v-model="selectedFormat"
                type="radio"
                name="academic-manuscript-format"
                value="docx"
                :disabled="submitting"
              />
              <span class="acad-export-format-icon">
                <AppIcon name="file" :size="19" />
              </span>
              <span class="acad-export-format-copy">
                <strong>{{ academicT("exportFormatDocxTitle") }}</strong>
                <small>{{ academicT("exportFormatDocxDesc") }}</small>
              </span>
              <span class="acad-export-format-check" aria-hidden="true">✓</span>
            </label>

            <label
              class="acad-export-format-card"
              :class="{ 'is-selected': selectedFormat === 'md' }"
            >
              <input
                v-model="selectedFormat"
                type="radio"
                name="academic-manuscript-format"
                value="md"
                :disabled="submitting"
              />
              <span class="acad-export-format-icon">
                <AppIcon name="file" :size="19" />
              </span>
              <span class="acad-export-format-copy">
                <strong>{{ academicT("exportFormatMdTitle") }}</strong>
                <small>{{ academicT("exportFormatMdDesc") }}</small>
              </span>
              <span class="acad-export-format-check" aria-hidden="true">✓</span>
            </label>
          </div>
        </fieldset>

        <fieldset v-if="selectedFormat === 'md'" class="acad-export-fieldset">
          <legend>{{ academicT("exportMdImageModeLegend") }}</legend>
          <div class="acad-export-mode-grid">
            <label
              class="acad-export-mode-option"
              :class="{ 'is-selected': selectedImageMode === 'assets_folder' }"
            >
              <input
                v-model="selectedImageMode"
                type="radio"
                name="academic-md-image-mode"
                value="assets_folder"
                :disabled="submitting"
              />
              <span>
                <strong>{{
                  academicT("exportMdImageAssetsFolderTitle")
                }}</strong>
                <small>{{ academicT("exportMdImageAssetsFolderDesc") }}</small>
              </span>
            </label>

            <label
              class="acad-export-mode-option"
              :class="{ 'is-selected': selectedImageMode === 'single_file' }"
            >
              <input
                v-model="selectedImageMode"
                type="radio"
                name="academic-md-image-mode"
                value="single_file"
                :disabled="submitting"
              />
              <span>
                <strong>{{ academicT("exportMdImageSingleFileTitle") }}</strong>
                <small>{{ academicT("exportMdImageSingleFileDesc") }}</small>
              </span>
            </label>
          </div>
        </fieldset>

        <footer class="acad-export-actions">
          <button
            type="button"
            class="acad-export-secondary-btn"
            :disabled="submitting"
            @click="requestClose"
          >
            {{ academicT("cancel") }}
          </button>
          <button
            type="submit"
            class="acad-export-primary-btn"
            :disabled="!canSubmit"
          >
            <AppIcon name="download" :size="15" />
            <span>
              {{
                submitting
                  ? academicT("exportingButton")
                  : academicT("exportConfirmButton")
              }}
            </span>
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.acad-export-backdrop {
  z-index: 2100;
}

.acad-export-dialog {
  width: min(640px, calc(100vw - 36px));
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.acad-export-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 13px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.acad-export-eyebrow {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 3px;
}

.acad-export-header h2 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.acad-export-body {
  display: grid;
  gap: 15px;
  padding: 16px 20px 18px;
  overflow-y: auto;
}

.acad-export-notice {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
}

.acad-export-notice-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.acad-export-notice p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.55;
}

.acad-export-fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 8px;
}

.acad-export-fieldset > legend,
.acad-export-section-head legend {
  padding: 0;
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 620;
}

.acad-export-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acad-export-quick-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.acad-export-count-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.acad-export-link-btn {
  padding: 2px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
}

.acad-export-link-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}

.acad-export-link-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.acad-export-tree-scroll {
  max-height: 210px;
  overflow-y: auto;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-raised);
}

.acad-export-chapter-group {
  display: grid;
  gap: 3px;
}

.acad-export-chapter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.acad-export-chapter-row:hover {
  background: var(--surface-hover);
}

.acad-export-chapter-row input,
.acad-export-item-row input,
.acad-export-hierarchy-toggle input {
  margin: 0;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.acad-export-chapter-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acad-export-chapter-children {
  display: grid;
  gap: 2px;
  padding-left: 20px;
}

.acad-export-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.acad-export-item-row:hover {
  background: var(--surface-hover);
}

.acad-export-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acad-export-empty-pill {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  flex-shrink: 0;
}

.acad-export-hierarchy-toggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-muted);
  cursor: pointer;
}

.acad-export-hierarchy-toggle input {
  margin-top: 3px;
}

.acad-export-hierarchy-copy {
  display: grid;
  gap: 2px;
}

.acad-export-hierarchy-copy strong {
  font-size: 0.785714rem;
  color: var(--text-primary);
}

.acad-export-hierarchy-copy small {
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.acad-export-format-grid,
.acad-export-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.acad-export-format-card {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 78px;
  padding: 11px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-raised);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.acad-export-format-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line));
  background: var(--surface-hover);
}

.acad-export-format-card.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
}

.acad-export-format-card input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.acad-export-format-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.acad-export-format-card.is-selected .acad-export-format-icon {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.acad-export-format-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding-right: 16px;
}

.acad-export-format-copy strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 620;
}

.acad-export-format-copy small {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.45;
}

.acad-export-format-check {
  position: absolute;
  top: 9px;
  right: 10px;
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
  opacity: 0;
}

.acad-export-format-card.is-selected .acad-export-format-check {
  opacity: 1;
}

.acad-export-mode-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  cursor: pointer;
}

.acad-export-mode-option.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
}

.acad-export-mode-option input {
  margin: 3px 0 0;
  accent-color: var(--accent);
}

.acad-export-mode-option span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.acad-export-mode-option strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
}

.acad-export-mode-option small {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.acad-export-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.acad-export-secondary-btn,
.acad-export-primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 550;
  cursor: pointer;
}

.acad-export-secondary-btn {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.acad-export-secondary-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}

.acad-export-primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.acad-export-primary-btn:disabled,
.acad-export-secondary-btn:disabled {
  opacity: 0.52;
  cursor: default;
}

@media (max-width: 560px) {
  .acad-export-format-grid,
  .acad-export-mode-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
