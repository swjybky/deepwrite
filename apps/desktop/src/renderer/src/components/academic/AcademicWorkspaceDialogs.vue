<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import {
  academicDialogTarget,
  closeAcademicDialog
} from "../../stores/academicWorkspaceDialog";
import AcademicFrameworkDialog from "./AcademicFrameworkDialog.vue";
import AcademicManuscriptDialog from "./AcademicManuscriptDialog.vue";
import AcademicMaterialCardImportDialog from "./AcademicMaterialCardImportDialog.vue";
import AcademicReferenceCardDialog from "./AcademicReferenceCardDialog.vue";

const ExportAcademicManuscriptDialog = defineAsyncComponent(
  () => import("./ExportAcademicManuscriptDialog.vue")
);
</script>

<template>
  <Teleport to="body">
    <AcademicFrameworkDialog
      v-if="academicDialogTarget?.kind === 'framework'"
      :book-id="academicDialogTarget.bookId"
      :initial-tab="academicDialogTarget.initialTab"
      @close="closeAcademicDialog"
    />
    <AcademicReferenceCardDialog
      v-else-if="academicDialogTarget?.kind === 'card'"
      :mode="academicDialogTarget.mode"
      :book-id="academicDialogTarget.bookId"
      :card-id="academicDialogTarget.cardId"
      :cite-key="academicDialogTarget.citeKey"
      :card-type="academicDialogTarget.cardType"
      :title="academicDialogTarget.title"
      @close="closeAcademicDialog"
    />
    <AcademicMaterialCardImportDialog
      v-else-if="academicDialogTarget?.kind === 'import-cards'"
      :book-id="academicDialogTarget.bookId"
      @close="closeAcademicDialog"
    />
    <AcademicManuscriptDialog
      v-else-if="academicDialogTarget?.kind === 'chapter'"
      target-kind="chapter"
      :mode="academicDialogTarget.mode"
      :book-id="academicDialogTarget.bookId"
      :chapter-id="academicDialogTarget.chapterId"
      :title="academicDialogTarget.title"
      :section-count="academicDialogTarget.sectionCount"
      @close="closeAcademicDialog"
    />
    <AcademicManuscriptDialog
      v-else-if="academicDialogTarget?.kind === 'section'"
      target-kind="section"
      :mode="academicDialogTarget.mode"
      :book-id="academicDialogTarget.bookId"
      :section-id="academicDialogTarget.sectionId"
      :chapter-id="academicDialogTarget.chapterId"
      :title="academicDialogTarget.title"
      :word-count-requirement="academicDialogTarget.wordCountRequirement"
      :after-section-id="academicDialogTarget.afterSectionId"
      @close="closeAcademicDialog"
    />
    <ExportAcademicManuscriptDialog
      v-else-if="academicDialogTarget?.kind === 'export'"
      :book-id="academicDialogTarget.bookId"
      :book-title="academicDialogTarget.bookTitle"
      @close="closeAcademicDialog"
    />
  </Teleport>
</template>
