<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import type {
  LongManuscriptExportFormat,
  LongManuscriptExportSection
} from "@deepwrite/contracts/renderer";
import type { LongManuscriptExportRequest } from "../utils/longManuscriptExport";
import {
  groupLongManuscriptExportChapters,
  listLongManuscriptExportChapters,
  type LongManuscriptExportChapterOption
} from "../utils/longManuscriptExportChapters";
import { uiMessage } from "../ui-feedback";
import ExportDialogShell from "./export/ExportDialogShell.vue";
import ExportScopeNotice from "./export/ExportScopeNotice.vue";
import ExportOptionCards, {
  type ExportOption
} from "./export/ExportOptionCards.vue";
import ExportChecklist from "./export/ExportChecklist.vue";

const t = createScopedTranslator("components.exportLongManuscriptDialog");
const chapterT = createScopedTranslator(
  "components.exportLongManuscriptChapterList"
);
const formatT = createScopedTranslator(
  "components.exportShortManuscriptDialog"
);

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

const options: readonly ExportOption<LongManuscriptExportSection>[] = [
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
      return t(
        mode.value === "folder"
          ? "selectedChaptersExportAsSeparateFiles"
          : "selectedChaptersMergeIntoOneFile"
      );
    },
    icon: "file"
  }
];

const selected = ref<LongManuscriptExportSection[]>(
  options.map(({ id }) => id)
);
type ExportMode = "folder" | "single-file";
const mode = ref<ExportMode>("folder");
const format = ref<LongManuscriptExportFormat>("txt");
const formats = computed<ExportOption<LongManuscriptExportFormat>[]>(() => [
  {
    id: "txt",
    label: formatT("tXTPlainText"),
    description: formatT("widelyCompatibleForReadingAndBackups")
  },
  {
    id: "md",
    label: formatT("markdownDocument"),
    description: formatT("preservesMarkdownFormatting")
  }
]);
const modes = computed<ExportOption<ExportMode>[]>(() => [
  { id: "folder", label: t("folderMode") },
  { id: "single-file", label: t("singleFileMode") }
]);
const imageExportDescription = computed(() => {
  if (format.value === "md") {
    return t(
      mode.value === "folder"
        ? "markdownFolderImages"
        : "markdownSingleFileImages"
    );
  }
  return t(mode.value === "folder" ? "txtFolderImages" : "txtSingleFileImages");
});
const chapters = ref<LongManuscriptExportChapterOption[]>([]);
const chapterGroups = computed(() =>
  groupLongManuscriptExportChapters(chapters.value).map((group) => ({
    id: group.volumeId,
    title: group.volumeTitle,
    items: group.chapters
  }))
);
const chaptersLoading = ref(false);
const chapterStatus = computed(() => {
  if (chaptersLoading.value) return chapterT("loadingChapters");
  return chapters.value.length
    ? ""
    : chapterT("thisBookHasNoManuscriptChaptersToExportYet");
});
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
    const snapshot = await deepwriteApi()?.long.getWorkspaceIndex({
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
    format.value = "txt";
    selected.value = options.map(({ id }) => id);
    selectedChapterIds.value = [];
    void loadChapters();
  },
  { immediate: true }
);

function submit(): void {
  if (!canSubmit.value) return;
  emit("export", {
    mode: mode.value,
    format: format.value,
    sections: [...selected.value],
    manuscriptChapterCardIds: manuscriptSelected.value
      ? [...selectedChapterIds.value]
      : []
  });
}
</script>

<template>
  <ExportDialogShell
    :open="open"
    :eyebrow="bookTitle"
    :title="t('exportNovel')"
    :action="mode === 'single-file' ? t('selectExportFile') : undefined"
    :submitting="submitting"
    :disabled="!canSubmit"
    @close="emit('close')"
    @submit="submit"
  >
    <ExportScopeNotice
      :description="t('scopeDescription')"
      :detail="imageExportDescription"
    />
    <ExportOptionCards
      v-model="format"
      :options="formats"
      :disabled="submitting"
    />
    <ExportOptionCards
      v-model="mode"
      compact
      :title="t('exportMode')"
      :options="modes"
      :disabled="submitting"
    />
    <ExportOptionCards
      v-model:selected="selected"
      :title="t('selectContentToExport')"
      :options="options"
      :disabled="submitting"
    />
    <ExportChecklist
      v-if="manuscriptSelected"
      v-model:selected-ids="selectedChapterIds"
      :title="chapterT('selectManuscriptChapters')"
      :entries="chapterGroups"
      :status="chapterStatus"
      :disabled="submitting || chaptersLoading"
    />
    <template #summary>
      <template v-if="manuscriptSelected && !chaptersLoading">
        {{
          chapterT("chaptersMessage", {
            arg0: selectedChapterIds.length,
            arg1: chapters.length
          })
        }}
      </template>
    </template>
  </ExportDialogShell>
</template>
