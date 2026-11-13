<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  LongManuscriptExportMode,
  LongManuscriptExportSection
} from "@deepwrite/contracts";
import type { IconName } from "../types/workspace";
import type { LongManuscriptExportRequest } from "../utils/longManuscriptExport";
import {
  listLongManuscriptExportChapters,
  type LongManuscriptExportChapterOption
} from "../utils/longManuscriptExportChapters";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import ExportLongManuscriptChapterList from "./ExportLongManuscriptChapterList.vue";

const t = createScopedTranslator("components.exportLongManuscriptDialog");

const props = defineProps<{
  open: boolean;
  bookTitle: string;
  bookId: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  export: [request: LongManuscriptExportRequest];
}>();

const options: ReadonlyArray<{
  id: LongManuscriptExportSection;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "worldbuilding",
    get label() {
      return t("worldbuilding");
    },
    get description() {
      return t("categoryContentAndAllEntries");
    },
    icon: "globe"
  },
  {
    id: "characters",
    get label() {
      return t("characters");
    },
    get description() {
      return t("overviewProfilesRelationshipsAndState");
    },
    icon: "user"
  },
  {
    id: "plot",
    get label() {
      return t("plot");
    },
    get description() {
      return t("volumesPlotPointsChapterCardsAndForeshadowing");
    },
    icon: "book"
  },
  {
    id: "manuscript",
    get label() {
      return t("manuscript");
    },
    get description() {
      return t("selectOneOrMoreChaptersEachExportsAsA");
    },
    icon: "file"
  }
];

const selected = ref<LongManuscriptExportSection[]>(
  options.map(({ id }) => id)
);
const mode = ref<LongManuscriptExportMode>("folder");
const chapters = ref<LongManuscriptExportChapterOption[]>([]);
const chaptersLoading = ref(false);
const selectedChapterIds = ref<string[]>([]);
let chaptersLoadId = 0;
const manuscriptSelected = computed(() =>
  selected.value.includes("manuscript")
);
const canSubmit = computed(() => {
  if (selected.value.length === 0 || props.submitting) return false;
  if (!manuscriptSelected.value) return true;
  return !chaptersLoading.value && selectedChapterIds.value.length > 0;
});

async function loadChapters(): Promise<void> {
  const loadId = ++chaptersLoadId;
  chaptersLoading.value = true;
  try {
    const snapshot = await window.deepwrite?.long.getWorkspaceIndex({
      bookId: props.bookId
    });
    if (loadId !== chaptersLoadId) return;
    if (!snapshot) {
      chapters.value = [];
      selectedChapterIds.value = [];
      uiMessage.error(t("couldNotLoadManuscriptChapters"));
      return;
    }
    chapters.value = listLongManuscriptExportChapters(snapshot.workspaceIndex);
    selectedChapterIds.value = chapters.value.map(({ id }) => id);
  } catch {
    if (loadId !== chaptersLoadId) return;
    chapters.value = [];
    selectedChapterIds.value = [];
    uiMessage.error(t("couldNotLoadManuscriptChapters"));
  } finally {
    if (loadId === chaptersLoadId) chaptersLoading.value = false;
  }
}

watch(
  () => [props.open, props.bookId] as const,
  ([open]) => {
    if (!open) return;
    mode.value = "folder";
    selected.value = options.map(({ id }) => id);
    selectedChapterIds.value = [];
    void loadChapters();
  },
  { immediate: true }
);

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  if (!canSubmit.value) return;
  emit("export", {
    mode: mode.value,
    sections: [...selected.value],
    manuscriptChapterCardIds: manuscriptSelected.value
      ? [...selectedChapterIds.value]
      : []
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog export-long-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-long-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ bookTitle }}</span>
            <h2 id="export-long-title">
              {{ t("exportNovel") }}
            </h2>
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
          class="dialog-content export-long-content"
          @submit.prevent="submit"
        >
          <div class="export-long-notice" role="note">
            <AppIcon :name="mode === 'folder' ? 'folder' : 'file'" :size="18" />
            <p>
              {{
                mode === "folder"
                  ? t("selectedContentExportsToOneFolderAsTXTFiles")
                  : t("selectedContentExportsToOneTXTFile")
              }}
            </p>
          </div>

          <p class="dialog-description">{{ t("imageExportDescription") }}</p>

          <fieldset class="export-long-options">
            <legend>{{ t("exportMode") }}</legend>
            <div class="export-long-mode-grid">
              <label
                v-for="choice in ['folder', 'single-txt'] as const"
                :key="choice"
                class="export-long-mode"
                :class="{ 'is-selected': mode === choice }"
              >
                <input
                  v-model="mode"
                  type="radio"
                  name="long-export-mode"
                  :value="choice"
                  :disabled="submitting"
                />
                <span>
                  <strong>{{
                    t(choice === "folder" ? "folderMode" : "singleTxtMode")
                  }}</strong>
                  <small>{{
                    t(
                      choice === "folder"
                        ? "folderModeDescription"
                        : "singleTxtModeDescription"
                    )
                  }}</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset class="export-long-options">
            <legend>
              {{ t("selectContentToExport") }}
            </legend>
            <div class="export-long-grid">
              <label
                v-for="option in options"
                :key="option.id"
                class="export-long-card"
                :class="{ 'is-selected': selected.includes(option.id) }"
              >
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="option.id"
                  :disabled="submitting"
                />
                <span class="export-long-icon"
                  ><AppIcon :name="option.icon" :size="20"
                /></span>
                <span class="export-long-copy"
                  ><strong>{{ option.label }}</strong
                  ><small>{{
                    option.id === "manuscript" && mode === "single-txt"
                      ? t("selectedChaptersMergeIntoOneTxt")
                      : option.description
                  }}</small></span
                >
                <span class="export-long-check" aria-hidden="true">✓</span>
              </label>
            </div>
          </fieldset>

          <ExportLongManuscriptChapterList
            v-if="manuscriptSelected"
            v-model:selected-ids="selectedChapterIds"
            :chapters="chapters"
            :loading="chaptersLoading"
            :disabled="submitting"
          />

          <div class="dialog-actions export-long-actions">
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
              type="submit"
              :disabled="!canSubmit"
            >
              <AppIcon name="download" :size="15" />
              {{
                submitting
                  ? t("preparingAndExporting")
                  : t(
                      mode === "folder"
                        ? "selectExportLocation"
                        : "selectExportFile"
                    )
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.export-long-dialog {
  width: min(650px, calc(100vw - 48px));
}
.export-long-content {
  display: grid;
  gap: 18px;
}
.export-long-notice {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 13px 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.export-long-notice p {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.65;
}
.export-long-options {
  min-width: 0;
  padding: 0;
  border: 0;
}
.export-long-options legend {
  margin-bottom: 9px;
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 620;
}
.export-long-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.export-long-mode {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  cursor: pointer;
}
.export-long-mode.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
}
.export-long-mode:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.export-long-mode input {
  margin: 0;
  accent-color: var(--accent);
}
.export-long-mode span {
  display: grid;
  gap: 3px;
}
.export-long-mode strong {
  font-size: 0.785714rem;
}
.export-long-mode small {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}
.export-long-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.export-long-card {
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 78px;
  padding: 12px;
  border: 1px solid var(--theme-line);
  border-radius: 11px;
  background: var(--surface-raised);
  cursor: pointer;
  transition: 120ms ease;
}
.export-long-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line));
  background: var(--surface-hover);
}
.export-long-card.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
}
.export-long-card input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.export-long-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.is-selected .export-long-icon {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.export-long-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.export-long-copy strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 620;
}
.export-long-copy small {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
  line-height: 1.45;
}
.export-long-check {
  position: absolute;
  top: 8px;
  right: 9px;
  display: none;
  color: var(--accent);
  font-size: 0.714286rem;
  font-weight: 700;
}
.is-selected .export-long-check {
  display: block;
}
.export-long-actions {
  margin-top: 0;
  padding-top: 2px;
}
@media (max-width: 580px) {
  .export-long-mode-grid,
  .export-long-grid {
    grid-template-columns: 1fr;
  }
}
</style>
