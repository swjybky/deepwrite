<script setup lang="ts">
import { computed } from "vue";
import type { LibraryPackageExportDialogState } from "../../composables/useLibraryPackageCoordinator";
import { createScopedTranslator } from "../../i18n";
import ExportDialogShell from "./ExportDialogShell.vue";
import ExportScopeNotice from "./ExportScopeNotice.vue";
import ExportOptionCards, { type ExportOption } from "./ExportOptionCards.vue";

defineProps<{ target: LibraryPackageExportDialogState; submitting: boolean }>();
const emit = defineEmits<{ close: []; submit: [] }>();
const t = createScopedTranslator("workspace.libraryPackageCoordinator");
const formats = computed<ExportOption<"zip">[]>(() => [
  {
    id: "zip",
    label: t("exportZipFormat"),
    description: t("exportZipDescription"),
    icon: "folder",
    wide: true
  }
]);
</script>

<template>
  <ExportDialogShell
    :eyebrow="target.title"
    :title="
      t(
        target.target.type === 'group'
          ? 'exportGroup'
          : target.domain === 'material'
            ? 'exportMaterial'
            : 'exportSkill'
      )
    "
    :submitting="submitting"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <ExportScopeNotice
      :description="
        target.target.type === 'library'
          ? t('exportLibraryScope')
          : target.memberCount === undefined
            ? t('exportGroupScope')
            : t('exportGroupScopeWithCount', { count: target.memberCount })
      "
    />
    <ExportOptionCards
      model-value="zip"
      :options="formats"
      :disabled="submitting"
    />
  </ExportDialogShell>
</template>
