<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import { inject, ref, watch } from "vue";
import { SHORT_MANUSCRIPT_PREVIEW_KEY } from "../composables/shortManuscriptPreviewContext";
import { useShortManuscriptCharacterCount } from "../composables/useShortManuscriptCharacterCount";
import type { ShortManuscriptExportTarget } from "../utils/shortManuscriptExport";
import ExportDialogShell from "./export/ExportDialogShell.vue";
import ExportScopeNotice from "./export/ExportScopeNotice.vue";
import ExportOptionCards, {
  type ExportOption
} from "./export/ExportOptionCards.vue";

const t = createScopedTranslator("components.exportShortManuscriptDialog");

const props = defineProps<{
  open: boolean;
  bookTitle: string;
  workspaceType?: "short" | "script";
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  export: [target: ShortManuscriptExportTarget];
}>();

const selectedTarget = ref<ShortManuscriptExportTarget>("docx");
const { characterCount, loading: characterCountLoading } =
  useShortManuscriptCharacterCount(
    inject(SHORT_MANUSCRIPT_PREVIEW_KEY, null),
    () => props.open
  );

const formats: readonly ExportOption<ShortManuscriptExportTarget>[] = [
  {
    id: "docx",
    get label() {
      return t("dOCXDocument");
    },
    get description() {
      return t("forFurtherFormattingEditingAndPrinting");
    },
    icon: "file"
  },
  {
    id: "txt",
    get label() {
      return t("tXTPlainText");
    },
    get description() {
      return t("widelyCompatibleForReadingAndBackups");
    },
    icon: "file"
  },
  {
    id: "epub",
    get label() {
      return t("ePUBEbook");
    },
    get description() {
      return t("forPhonesAndEbookReaders");
    },
    icon: "book"
  },
  {
    id: "md",
    get label() {
      return t("markdownDocument");
    },
    get description() {
      return t("preservesMarkdownFormatting");
    },
    icon: "file"
  },
  {
    id: "clipboard",
    get label() {
      return t("copyManuscript");
    },
    get description() {
      return t("copyTheFullManuscriptToPasteAnywhere");
    },
    icon: "copy",
    wide: true,
    get badge() {
      if (characterCount.value !== null) {
        return t("fullManuscriptValueCharacters", {
          arg0: characterCount.value.toLocaleString(locale.value)
        });
      }
      return t(
        characterCountLoading.value
          ? "countingFullManuscript"
          : "fullManuscriptCountUnavailable"
      );
    }
  }
];

watch(
  () => props.open,
  (open) => {
    if (open) selectedTarget.value = "docx";
  }
);
</script>

<template>
  <ExportDialogShell
    :open="open"
    :eyebrow="bookTitle"
    :title="
      t('exportMessage', {
        arg0: t(
          workspaceType === 'script' ? 'episodeManuscripts' : 'manuscript'
        )
      })
    "
    :action="
      t(
        selectedTarget === 'clipboard' ? 'copyManuscript' : 'selectSaveLocation'
      )
    "
    :copy="selectedTarget === 'clipboard'"
    :submitting="submitting"
    @close="emit('close')"
    @submit="emit('export', selectedTarget)"
  >
    <ExportScopeNotice
      :description="
        t(
          workspaceType === 'script'
            ? 'exportsAllEpisodeManuscriptsOnlyExcludingCharacterStatePlot'
            : 'exportsTheIntroductionAndAllManuscriptSectionsOnlyExcluding'
        )
      "
      :detail="t('imageExportDescription')"
    />
    <ExportOptionCards
      v-model="selectedTarget"
      :options="formats"
      :disabled="submitting"
    />
  </ExportDialogShell>
</template>
