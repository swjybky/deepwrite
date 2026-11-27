<script setup lang="ts">
import { uiConfirm } from "../../ui-confirm";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, onMounted } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const t = createScopedTranslator("extras.longBookAnalysis");

const props = defineProps<{
  controller: Pick<
    LongBookAnalysisController,
    | "source"
    | "savedSources"
    | "sourcesLoading"
    | "sourceSaving"
    | "sourceDeleting"
    | "loadSavedSources"
    | "loadSavedSource"
    | "deleteSavedSource"
    | "chooseSource"
    | "isBusy"
  >;
  disabled?: boolean;
  /** Replaces the default "preset management" label, e.g. for profiles. */
  manageLabel?: string;
}>();
const emit = defineEmits<{
  managePresets: [];
}>();
const manageText = computed(() => props.manageLabel ?? t("managePresets"));

const importedAtFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short"
    })
);
const sourceId = computed(() => props.controller.source.value?.id ?? "");
const controlsDisabled = computed(
  () =>
    props.disabled ||
    props.controller.isBusy.value ||
    props.controller.sourceSaving.value ||
    props.controller.sourceDeleting.value
);
const savedSourceOptions = computed<PopupSelectOption[]>(() =>
  props.controller.savedSources.value.map((savedSource) => ({
    value: savedSource.id,
    label: savedSource.name,
    description: t("sourceDetails", {
      kind: savedSource.kind === "txt" ? "TXT" : t("chapterFolder"),
      chapters: savedSource.chapterCount.toLocaleString(locale.value),
      characters: savedSource.characterCount.toLocaleString(locale.value),
      date: importedAtFormatter.value.format(new Date(savedSource.importedAt))
    }),
    actionIcon: "trash",
    actionLabel: t("deleteNovel", { title: savedSource.name })
  }))
);
const savedSourcePlaceholder = computed(() => {
  if (props.controller.sourcesLoading.value) return t("loadingImportedNovels");
  return savedSourceOptions.value.length > 0
    ? t("chooseImportedNovel")
    : t("noImportedNovels");
});

async function importSource(kind: "txt" | "directory"): Promise<void> {
  try {
    if (await props.controller.chooseSource(kind)) {
      uiMessage.success(
        kind === "txt" ? t("textImported") : t("chapterFolderImported")
      );
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("sourceImportFailed")));
  }
}

async function loadSavedSource(value: string | number): Promise<void> {
  try {
    if (await props.controller.loadSavedSource(String(value))) {
      uiMessage.success(t("novelLoaded"));
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("novelLoadFailed")));
  }
}

async function deleteSavedSource(value: string | number): Promise<void> {
  const id = String(value);
  const saved = props.controller.savedSources.value.find(
    (item) => item.id === id
  );
  if (controlsDisabled.value || !saved) return;
  if (
    !(await uiConfirm({
      message: t("deleteNovelConfirmation", { title: saved.name }),
      danger: true
    }))
  )
    return;
  try {
    await props.controller.deleteSavedSource(id);
    uiMessage.success(t("novelDeleted"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("novelDeleteFailed")));
  }
}

onMounted(() => {
  void props.controller.loadSavedSources().catch((error: unknown) => {
    uiMessage.error(formatError(error, t("novelLoadFailed")));
  });
});
</script>

<template>
  <div class="analysis-page-controls">
    <div class="analysis-source-picker">
      <PopupSelect
        :model-value="sourceId"
        :options="savedSourceOptions"
        :accessible-label="t('chooseImportedNovel')"
        :placeholder="savedSourcePlaceholder"
        :disabled="
          controlsDisabled ||
          controller.sourcesLoading.value ||
          savedSourceOptions.length === 0
        "
        :menu-min-width="320"
        @change="loadSavedSource"
        @option-action="deleteSavedSource"
      >
        <template #prefix>
          <AppIcon name="book" :size="15" />
        </template>
      </PopupSelect>
    </div>
    <div class="analysis-page-actions">
      <button
        type="button"
        :disabled="controlsDisabled"
        @click="importSource('txt')"
      >
        <AppIcon name="file" :size="16" />{{ t("importTxt") }}
      </button>
      <button
        type="button"
        :disabled="controlsDisabled"
        @click="importSource('directory')"
      >
        <AppIcon name="folder" :size="16" />{{ t("chapterFolder") }}
      </button>
      <button
        type="button"
        :title="manageText"
        :aria-label="manageText"
        :disabled="controlsDisabled"
        @click="emit('managePresets')"
      >
        {{ manageText }}
      </button>
      <slot />
    </div>
  </div>
</template>
