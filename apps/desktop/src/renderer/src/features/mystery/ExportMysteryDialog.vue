<script setup lang="ts">
import { computed, ref } from "vue";
import ExportDialogShell from "../../components/export/ExportDialogShell.vue";
import ExportScopeNotice from "../../components/export/ExportScopeNotice.vue";
import ExportOptionCards, {
  type ExportOption
} from "../../components/export/ExportOptionCards.vue";
import { createScopedTranslator } from "../../i18n";
import { mysteryT } from "./messages";

type ExportFormat = "docx" | "md";
type ExportLayout = "by-role" | "by-role-act";

defineProps<{
  open: boolean;
  bookTitle: string;
  submitting: boolean;
  nested: boolean;
}>();
const emit = defineEmits<{
  close: [];
  exportBundle: [
    payload: { format: ExportFormat; playerScriptLayout: ExportLayout }
  ];
}>();

const format = ref<ExportFormat>("docx");
const layout = ref<ExportLayout>("by-role");
const formatT = createScopedTranslator(
  "components.exportShortManuscriptDialog"
);
const formats = computed<ExportOption<ExportFormat>[]>(() => [
  {
    id: "docx",
    label: mysteryT("exportFormatDocx"),
    description: formatT("forFurtherFormattingEditingAndPrinting")
  },
  {
    id: "md",
    label: mysteryT("exportFormatMd"),
    description: formatT("preservesMarkdownFormatting")
  }
]);
const layouts = computed<ExportOption<ExportLayout>[]>(() => [
  { id: "by-role", label: mysteryT("exportLayoutByRole") },
  { id: "by-role-act", label: mysteryT("exportLayoutByRoleAct") }
]);
</script>

<template>
  <ExportDialogShell
    :open="open"
    :eyebrow="bookTitle"
    :title="mysteryT('exportDialogTitle')"
    :submitting="submitting"
    :nested="nested"
    @close="emit('close')"
    @submit="emit('exportBundle', { format, playerScriptLayout: layout })"
  >
    <ExportScopeNotice :description="mysteryT('exportSubtitle')" />
    <ExportOptionCards
      v-model="format"
      :options="formats"
      :disabled="submitting"
    />
    <ExportOptionCards
      v-model="layout"
      compact
      :title="mysteryT('exportLayoutLabel')"
      :options="layouts"
      :disabled="submitting"
    />
  </ExportDialogShell>
</template>
