<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  AcademicManuscriptExportFormat,
  AcademicManuscriptImageMode
} from "@deepwrite/contracts/renderer";
import ExportDialogShell from "../export/ExportDialogShell.vue";
import ExportScopeNotice from "../export/ExportScopeNotice.vue";
import ExportOptionCards, {
  type ExportOption
} from "../export/ExportOptionCards.vue";
import ExportChecklist, {
  type ExportChecklistEntry
} from "../export/ExportChecklist.vue";
import { createScopedTranslator } from "../../i18n";
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
  type AcademicManuscriptExportSectionOption
} from "../../utils/academicManuscriptExport";

const commonT = createScopedTranslator(
  "components.exportShortManuscriptDialog"
);

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

const checklist = computed<ExportChecklistEntry[]>(() => {
  const { leadingSections, chapters, trailingSections } = exportTree.value;
  const item = ({
    id,
    title,
    nonEmpty
  }: AcademicManuscriptExportSectionOption) => ({
    id,
    title,
    empty: !nonEmpty
  });
  return [
    ...leadingSections.map(item),
    ...chapters.map(({ id, title, sections }) => ({
      id,
      title,
      items: sections.map(item)
    })),
    ...trailingSections.map(item)
  ];
});
const formats = computed<ExportOption<AcademicManuscriptExportFormat>[]>(() => [
  {
    id: "docx",
    label: academicT("exportFormatDocxTitle"),
    description: academicT("exportFormatDocxDesc")
  },
  {
    id: "md",
    label: academicT("exportFormatMdTitle"),
    description: academicT("exportFormatMdDesc")
  }
]);
const imageModes = computed<ExportOption<AcademicManuscriptImageMode>[]>(() => [
  {
    id: "assets_folder",
    label: academicT("exportMdImageAssetsFolderTitle")
  },
  {
    id: "single_file",
    label: academicT("exportMdImageSingleFileTitle")
  }
]);

function updateSelection(ids: string[]): void {
  const selected = new Set(ids);
  selectedSectionIds.value = exportTree.value.orderedSections
    .filter((item) => selected.has(item.id))
    .map((item) => item.id);
}

async function submit(): Promise<void> {
  if (submitting.value || selectedSectionIds.value.length === 0) return;
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
</script>

<template>
  <ExportDialogShell
    :eyebrow="displayBookTitle"
    :title="academicT('exportDialogTitle')"
    :action="commonT('selectSaveLocation')"
    :submitting="submitting"
    :disabled="!selectedSectionIds.length"
    @close="emit('close')"
    @submit="submit"
  >
    <ExportScopeNotice
      :description="academicT('exportScopeNote')"
      :detail="
        selectedFormat === 'md'
          ? academicT(
              selectedImageMode === 'assets_folder'
                ? 'exportMdImageAssetsFolderDesc'
                : 'exportMdImageSingleFileDesc'
            )
          : undefined
      "
    />
    <ExportOptionCards
      v-model="selectedFormat"
      :options="formats"
      :disabled="submitting"
    />
    <ExportOptionCards
      v-if="selectedFormat === 'md'"
      v-model="selectedImageMode"
      compact
      :options="imageModes"
      :title="academicT('exportMdImageModeLegend')"
      :disabled="submitting"
    />
    <ExportChecklist
      :selected-ids="selectedSectionIds"
      :entries="checklist"
      :title="academicT('exportSectionsLegend')"
      :select-non-empty-label="academicT('exportSelectNonEmpty')"
      :clear-label="academicT('exportClearAll')"
      :disabled="submitting"
      @update:selected-ids="updateSelection"
    />
    <label v-if="exportTree.hasChapters" class="academic-export-headings">
      <input
        v-model="includeChapterHeadings"
        type="checkbox"
        :disabled="submitting"
      />
      <span>
        <strong>{{ academicT("exportIncludeChapterHeadings") }}</strong>
        <small>{{ academicT("exportIncludeChapterHeadingsHint") }}</small>
      </span>
    </label>
  </ExportDialogShell>
</template>

<style scoped>
.academic-export-headings {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--text-primary);
  font-size: 0.857143rem;
}
.academic-export-headings input {
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}
.academic-export-headings small {
  display: block;
  color: var(--text-secondary);
  font-size: 0.785714rem;
}
</style>
