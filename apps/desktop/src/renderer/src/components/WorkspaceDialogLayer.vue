<script setup lang="ts">
import DialogHost from "./DialogHost.vue";
import {
  BookResourceDialog,
  BookTransferDialog,
  CharacterItemDialog,
  CreateBookDialog,
  CreateExpertSectionDialog,
  CreateLongChapterCardDialog,
  CreateLongCharacterDialog,
  CreateLongPlotPointDialog,
  CreateLongWorldbuildingItemDialog,
  CreateLongVolumeDialog,
  DeleteExpertSectionDialog,
  DeleteLongDraftSectionDialog,
  ExportLongManuscriptDialog,
  ExportShortManuscriptDialog,
  ExternalSkillImportDialog,
  LibraryEntryMoveDialog,
  LibraryGroupDialog,
  LibraryProjectDialog,
  LibraryRemovalDialog,
  LongBookBindingsDialog,
  LongBookRemovalDialog,
  LongBookRenameDialog,
  LongContinuationImportDialog,
  LongLegacySyncDialog,
  LongStructureDialog,
  PlotStructureDialog,
  SaveConflictDialog,
  StartupAlertDialog
} from "./lazyAppComponents";
import type {
  WorkspaceDialogLayerEmits,
  WorkspaceDialogModule
} from "./WorkspaceDialogLayer.types";

defineProps<{
  module: WorkspaceDialogModule | null;
}>();

const emit = defineEmits<WorkspaceDialogLayerEmits>();
</script>

<template>
  <DialogHost v-if="module" :active-dialog="module.kind">
    <BookResourceDialog
      v-if="module.kind === 'book-resource'"
      :mode="module.mode"
      :book="module.book"
      :skill-libraries="module.skillLibraries"
      :material-libraries="module.materialLibraries"
      :material-groups="module.materialGroups"
      :skill-groups="module.skillGroups"
      :loading="module.loading"
      :submitting="module.submitting"
      @close="emit('closeBookResource')"
      @rename="emit('renameBook', $event)"
      @remove="emit('removeBook', $event)"
      @delete="emit('deleteBook', $event)"
      @update-bindings="emit('updateBookBindings', $event)"
    />

    <PlotStructureDialog
      v-else-if="module.kind === 'plot-structure'"
      open
      :book="module.book"
      :pending="module.pending"
      :writing-context="module.writingContext"
      :writing-context-loading="module.writingContextLoading"
      :writing-context-pending="module.writingContextPending"
      @close="emit('closePlotStructure')"
      @mutation="
        (mutation, completion) =>
          emit('plotStructureMutation', mutation, completion)
      "
      @character-mutation="
        (mutation, completion) =>
          emit('characterStructureMutation', mutation, completion)
      "
      @save-writing-context="
        (content, completion) => emit('saveWritingContext', content, completion)
      "
    />

    <CharacterItemDialog
      v-else-if="module.kind === 'character-item'"
      open
      :mode="module.mode"
      :title="module.title"
      :pending="module.pending"
      @close="emit('closeCharacterItem')"
      @submit="emit('submitCharacterItem', $event)"
    />

    <ExportShortManuscriptDialog
      v-else-if="module.kind === 'export-short'"
      open
      :book-title="module.bookTitle"
      :workspace-type="module.workspaceType"
      :submitting="module.submitting"
      @close="emit('closeExportShort')"
      @export="emit('exportShort', $event)"
    />

    <ExportLongManuscriptDialog
      v-else-if="module.kind === 'export-long'"
      open
      :book-title="module.bookTitle"
      :submitting="module.submitting"
      @close="emit('closeExportLong')"
      @export="emit('exportLong', $event)"
    />

    <LibraryRemovalDialog
      v-else-if="module.kind === 'library-removal'"
      open
      :action="module.action"
      :domain="module.domain"
      :label="module.label"
      :submitting="module.submitting"
      @close="emit('closeLibraryRemoval')"
      @confirm="emit('confirmLibraryRemoval')"
    />

    <CreateBookDialog
      v-else-if="module.kind === 'create-book'"
      open
      :materials="module.materials"
      :material-groups="module.materialGroups"
      :skills="module.skills"
      :skill-groups="module.skillGroups"
      :loading="module.loading"
      :submitting="module.submitting"
      @close="emit('closeCreateBook')"
      @submit="emit('submitCreateBook', $event)"
    />

    <BookTransferDialog
      v-else-if="module.kind === 'book-transfer'"
      :mode="module.mode"
      :pending="module.pending"
      @close="emit('closeBookTransfer')"
      @select="emit('selectBookTransfer', $event)"
    />

    <LongContinuationImportDialog
      v-else-if="module.kind === 'continuation-import'"
      :preview="module.preview"
      :submitting="module.submitting"
      @close="emit('closeContinuationImport')"
      @confirm="emit('confirmContinuationImport', $event)"
    />

    <LongLegacySyncDialog
      v-else-if="module.kind === 'legacy-sync'"
      :preview="module.preview"
      :result="module.result"
      :pending="module.pending"
      @close="emit('closeLegacySync')"
      @confirm="emit('confirmLegacySync', $event)"
    />

    <LongStructureDialog
      v-else-if="module.kind === 'long-structure'"
      open
      :book-title="module.bookTitle"
      :book-id="module.bookId"
      :agents-md="module.agentsMd"
      :agents-md-pending="module.agentsMdPending"
      :sync-book-options="module.syncBookOptions"
      :snapshot="module.snapshot"
      :pending="module.pending"
      @close="emit('closeLongStructure')"
      @mutation="
        (batch, completion) => emit('longStructureMutation', batch, completion)
      "
      @save-agents-md="
        (content, completion) => emit('saveLongAgentsMd', content, completion)
      "
      @sync-worldbuilding="
        (payload, completion) =>
          emit('syncLongWorldbuilding', payload, completion)
      "
    />

    <CreateLongCharacterDialog
      v-else-if="module.kind === 'create-long-character'"
      open
      :group-label="module.groupLabel"
      :pending="module.pending"
      @close="emit('closeCreateLongCharacter')"
      @submit="emit('submitCreateLongCharacter', $event)"
    />

    <CreateLongWorldbuildingItemDialog
      v-else-if="module.kind === 'create-long-worldbuilding-item'"
      open
      :category-title="module.categoryTitle"
      :pending="module.pending"
      @close="emit('closeCreateLongWorldbuildingItem')"
      @submit="emit('submitCreateLongWorldbuildingItem', $event)"
    />

    <CreateLongPlotPointDialog
      v-else-if="module.kind === 'create-long-plot-point'"
      open
      :volume-title="module.volumeTitle"
      :pending="module.pending"
      @close="emit('closeCreateLongPlotPoint')"
      @submit="emit('submitCreateLongPlotPoint', $event)"
    />

    <CreateLongChapterCardDialog
      v-else-if="module.kind === 'create-long-chapter-card'"
      open
      :volume-title="module.volumeTitle"
      :arc-options="module.arcOptions"
      :source="module.source"
      :pending="module.pending"
      @close="emit('closeCreateLongChapterCard')"
      @submit="emit('submitCreateLongChapterCard', $event)"
    />

    <DeleteLongDraftSectionDialog
      v-else-if="module.kind === 'delete-long-draft'"
      open
      :section-title="module.sectionTitle"
      :description="module.description"
      :pending="module.pending"
      @close="emit('closeDeleteLongDraft')"
      @confirm="emit('confirmDeleteLongDraft')"
    />

    <DeleteLongDraftSectionDialog
      v-else-if="module.kind === 'delete-long-tree'"
      open
      :section-title="module.sectionTitle"
      eyebrow="长篇结构"
      :item-label="module.itemLabel"
      :description="module.description"
      :pending="module.pending"
      @close="emit('closeDeleteLongTree')"
      @confirm="emit('confirmDeleteLongTree')"
    />

    <DeleteLongDraftSectionDialog
      v-else-if="module.kind === 'delete-long-ledger-commit'"
      open
      :section-title="module.title"
      eyebrow="连续性账本"
      item-label="提交记录"
      :description="
        module.chapterCount === 1
          ? '删除后，该章节将重新回到待提交状态。正文和连续性 Markdown 文件保持不变；本条提交记录本身不可恢复，重新提交会生成新记录。'
          : '删除后，本次涉及的 ' +
            module.chapterCount +
            ' 个章节将重新回到待提交状态。正文和连续性 Markdown 文件保持不变；本条提交记录本身不可恢复，重新提交会生成新记录。'
      "
      :pending="module.pending"
      @close="emit('closeDeleteLongLedgerCommit')"
      @confirm="emit('confirmDeleteLongLedgerCommit')"
    />

    <CreateLongVolumeDialog
      v-else-if="module.kind === 'create-long-volume'"
      open
      :source="module.source"
      :pending="module.pending"
      @close="emit('closeCreateLongVolume')"
      @submit="emit('submitCreateLongVolume', $event)"
    />

    <LongBookBindingsDialog
      v-else-if="module.kind === 'long-bindings'"
      :mode="module.mode"
      :book-title="module.bookTitle"
      :materials="module.materials"
      :skills="module.skills"
      :linked-material-ids-by-kind="module.linkedMaterialIdsByKind"
      :linked-skill-ids-by-kind="module.linkedSkillIdsByKind"
      :linked-resource-stage-scopes="module.linkedResourceStageScopes"
      :submitting="module.submitting"
      @close="emit('closeLongBindings')"
      @submit="emit('submitLongBindings', $event)"
    />

    <LongBookRenameDialog
      v-else-if="module.kind === 'long-rename'"
      open
      :title="module.title"
      :pending="module.pending"
      @close="emit('closeLongRename')"
      @submit="emit('submitLongRename', $event)"
    />

    <LongBookRemovalDialog
      v-else-if="module.kind === 'long-removal'"
      open
      :action="module.action"
      :title="module.title"
      :pending="module.pending"
      @close="emit('closeLongRemoval')"
      @confirm="emit('confirmLongRemoval')"
    />

    <LibraryProjectDialog
      v-else-if="module.kind === 'library-project'"
      open
      :operation="module.operation"
      :domain="module.domain"
      :library-id="module.libraryId"
      :library-title="module.libraryTitle"
      :material-kind="module.materialKind"
      :entry-id="module.entryId"
      :entry-title="module.entryTitle"
      :workspace-type="module.workspaceType"
      :submitting="module.submitting"
      @close="emit('closeLibraryProject')"
      @create-library="emit('createLibrary', $event)"
      @create-entry="emit('createLibraryEntry', $event)"
      @rename-library="emit('renameLibrary', $event)"
      @rename-entry="emit('renameLibraryEntry', $event)"
      @remove-entry="emit('removeLibraryEntry', $event)"
    />

    <ExternalSkillImportDialog
      v-else-if="module.kind === 'external-library-import'"
      open
      :domain="module.domain"
      :libraries="module.libraries"
      :preselected-library-id="module.preselectedLibraryId"
      :selection="module.selection"
      :pending="module.pending"
      @close="emit('closeExternalLibraryImport')"
      @choose="emit('chooseExternalLibraryImport', $event)"
      @submit="emit('submitExternalLibraryImport', $event)"
    />

    <LibraryEntryMoveDialog
      v-else-if="module.kind === 'library-entry-move'"
      open
      :entry-title="module.entryTitle"
      :target-library-title="module.targetLibraryTitle"
      :options="module.options"
      :initial-stage-id="module.initialStageId"
      :submitting="module.submitting"
      @close="emit('closeLibraryEntryMove')"
      @submit="emit('submitLibraryEntryMove', $event)"
    />

    <LibraryGroupDialog
      v-else-if="module.kind === 'library-group'"
      open
      :domain="module.domain"
      :group="module.group"
      :materials="module.materials"
      :material-groups="module.materialGroups"
      :skills="module.skills"
      :skill-groups="module.skillGroups"
      :submitting="module.submitting"
      @close="emit('closeLibraryGroup')"
      @submit="emit('submitLibraryGroup', $event)"
    />

    <SaveConflictDialog
      v-else-if="module.kind === 'save-conflict'"
      open
      :title="module.title"
      :draft-content="module.draftContent"
      :disk-content="module.diskContent"
      :submitting="module.submitting"
      @keep="emit('keepSaveConflict')"
      @reload="emit('reloadSaveConflict')"
      @overwrite="emit('overwriteSaveConflict')"
    />

    <CreateExpertSectionDialog
      v-else-if="module.kind === 'create-expert-section'"
      open
      :suggested-title="module.suggestedTitle"
      :workspace-type="module.workspaceType"
      :pending="module.pending"
      @close="emit('closeCreateExpertSection')"
      @submit="emit('submitCreateExpertSection', $event)"
    />

    <DeleteExpertSectionDialog
      v-else-if="module.kind === 'delete-expert-section'"
      open
      :section-title="module.sectionTitle"
      :has-content="module.hasContent"
      :workspace-type="module.workspaceType"
      @close="emit('closeDeleteExpertSection')"
      @confirm="emit('confirmDeleteExpertSection')"
    />

    <StartupAlertDialog
      v-else-if="module.kind === 'startup-alert'"
      open
      :messages="module.messages"
      @close="emit('closeStartupAlert')"
    />
  </DialogHost>
</template>
