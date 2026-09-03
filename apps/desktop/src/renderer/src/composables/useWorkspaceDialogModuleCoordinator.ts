import type {
  Book,
  CatalogIndexSnapshot,
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { computed, type Ref } from "vue";
import type {
  WorkspaceDialogKind,
  WorkspaceDialogModule
} from "../components/WorkspaceDialogLayer.types";
import type { ResourceTreeNode } from "../types/workspace";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import type {
  ExternalSkillImportDialogState,
  LibraryGroupDialogState,
  LibraryProjectDialogState,
  LibraryRemovalDialogState,
  PendingLibraryEntryMove
} from "./useCatalogLibraryTransactionsCoordinator";
import type { SaveConflictState } from "./useCatalogDocumentPersistence";
import type { ShortBookLifecycleTarget } from "./useShortBookLifecycleCoordinator";
import type {
  CharacterItemDialogState,
  PendingExpertSectionCreation,
  PendingExpertSectionDeletion
} from "./useShortWorkspaceStructureCoordinator";
import type {
  LongBookRemovalTarget,
  LongBookRenameTarget,
  LongChapterCardCreateTarget,
  LongCharacterCreateTarget,
  LongDraftSectionDeleteTarget,
  LongLedgerCommitDeleteTarget,
  LongPlotPointCreateTarget,
  LongTreeItemDeleteTarget,
  LongVolumeCreateTarget,
  LongWorldbuildingItemCreateTarget
} from "../stores/longWorkspaceStore";

type DialogModule<Kind extends WorkspaceDialogKind> = Extract<
  WorkspaceDialogModule,
  { kind: Kind }
>;
export const WORKSPACE_DIALOG_PRIORITY = [
  "startup-alert",
  "save-conflict",
  "create-expert-section",
  "delete-expert-section",
  "continuation-import",
  "legacy-sync",
  "create-long-character",
  "create-long-worldbuilding-item",
  "create-long-plot-point",
  "create-long-chapter-card",
  "delete-long-draft",
  "delete-long-tree",
  "delete-long-ledger-commit",
  "create-long-volume",
  "long-bindings",
  "long-rename",
  "long-removal",
  "long-structure",
  "character-item",
  "plot-structure",
  "export-short",
  "export-long",
  "library-removal",
  "library-project",
  "external-skill-import",
  "library-entry-move",
  "library-group",
  "create-book",
  "book-transfer",
  "book-resource"
] as const satisfies readonly WorkspaceDialogKind[];

export interface WorkspaceDialogStartupState {
  messages: Readonly<Ref<readonly string[]>>;
}

export interface WorkspaceDialogSaveState {
  conflict: Readonly<Ref<SaveConflictState | null>>;
  submitting: Readonly<Ref<boolean>>;
}

export interface WorkspaceDialogShortStructureState {
  expertCreation: Readonly<Ref<PendingExpertSectionCreation | null>>;
  expertDeletion: Readonly<Ref<PendingExpertSectionDeletion | null>>;
  characterDialog: Readonly<Ref<CharacterItemDialogState | null>>;
  plotBookId: Readonly<Ref<string | null>>;
  plotBook: Readonly<Ref<Book | null>>;
  writingContext?: Readonly<Ref<string | null>>;
  writingContextLoading?: Readonly<Ref<boolean>>;
  writingContextPending?: Readonly<Ref<boolean>>;
}

export interface WorkspaceDialogLongStructureState {
  characterCreation: Readonly<Ref<LongCharacterCreateTarget | null>>;
  worldbuildingItemCreation: Readonly<
    Ref<LongWorldbuildingItemCreateTarget | null>
  >;
  plotPointCreation: Readonly<Ref<LongPlotPointCreateTarget | null>>;
  chapterCardCreation: Readonly<Ref<LongChapterCardCreateTarget | null>>;
  draftDeletion: Readonly<Ref<LongDraftSectionDeleteTarget | null>>;
  treeDeletion: Readonly<Ref<LongTreeItemDeleteTarget | null>>;
  ledgerCommitDeletion: Readonly<Ref<LongLedgerCommitDeleteTarget | null>>;
  volumeCreation: Readonly<Ref<LongVolumeCreateTarget | null>>;
  dialogOpen: Readonly<Ref<boolean>>;
  agentsMd: Readonly<Ref<string | null>>;
  agentsMdPending: Readonly<Ref<boolean>>;
  syncBookOptions: Readonly<Ref<readonly LongWorldbuildingSyncBookOption[]>>;
}

export interface WorkspaceDialogLongLifecycleState {
  continuationPreview: Readonly<
    Ref<DialogModule<"continuation-import">["preview"] | null>
  >;
  legacyPreview: Readonly<Ref<DialogModule<"legacy-sync">["preview"]>>;
  legacyResult: Readonly<Ref<DialogModule<"legacy-sync">["result"]>>;
  mutationPending: Readonly<Ref<boolean>>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  activeBookId: Readonly<Ref<string | null>>;
  workspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
  bindingsMode: Readonly<Ref<"skill" | "material" | null>>;
  bookActionPending: Readonly<Ref<boolean>>;
  renameTarget: Readonly<Ref<LongBookRenameTarget | null>>;
  removalTarget: Readonly<Ref<LongBookRemovalTarget | null>>;
  exportTarget: Readonly<Ref<LongBookRenameTarget | null>>;
  manuscriptExportPending: Readonly<Ref<boolean>>;
}

export interface WorkspaceDialogShortLifecycleState {
  exportTarget: Readonly<Ref<ShortBookLifecycleTarget | null>>;
  manuscriptExportPending: Readonly<Ref<boolean>>;
  createDialogOpen: Readonly<Ref<boolean>>;
  transferMode: Readonly<Ref<DialogModule<"book-transfer">["mode"] | null>>;
  resourceMode: Readonly<Ref<DialogModule<"book-resource">["mode"] | null>>;
  activeBookTarget: Readonly<Ref<ShortBookLifecycleTarget | null>>;
}

export interface WorkspaceDialogLibraryState {
  removalDialog: Readonly<Ref<LibraryRemovalDialogState | null>>;
  projectDialog: Readonly<Ref<LibraryProjectDialogState | null>>;
  externalSkillImportDialog: Readonly<
    Ref<ExternalSkillImportDialogState | null>
  >;
  entryMove: Readonly<Ref<PendingLibraryEntryMove | null>>;
  groupDialog: Readonly<Ref<LibraryGroupDialogState | null>>;
  activeGroup: Readonly<Ref<DialogModule<"library-group">["group"]>>;
}

export interface WorkspaceDialogCatalogState {
  snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  loading: Readonly<Ref<boolean>>;
  mutationPending: Readonly<Ref<boolean>>;
  skillLibraries: Readonly<Ref<ResourceTreeNode[]>>;
  materialLibraries: Readonly<Ref<ResourceTreeNode[]>>;
  materialStageOptions(
    materialKind: PendingLibraryEntryMove["targetMaterialKind"]
  ): DialogModule<"library-entry-move">["options"];
}

export interface WorkspaceDialogModuleCoordinatorOptions {
  startup: WorkspaceDialogStartupState;
  save: WorkspaceDialogSaveState;
  shortStructure: WorkspaceDialogShortStructureState;
  longStructure: WorkspaceDialogLongStructureState;
  longLifecycle: WorkspaceDialogLongLifecycleState;
  shortLifecycle: WorkspaceDialogShortLifecycleState;
  library: WorkspaceDialogLibraryState;
  catalog: WorkspaceDialogCatalogState;
}

/**
 * Projects coordinator-owned dialog intents into one low-frequency render
 * descriptor. It owns no transactions and deliberately stops reading state as
 * soon as the highest-priority active dialog is found.
 */
export function useWorkspaceDialogModuleCoordinator(
  options: WorkspaceDialogModuleCoordinatorOptions
): Readonly<Ref<WorkspaceDialogModule | null>> {
  return computed<WorkspaceDialogModule | null>(() => {
    const startupMessages = options.startup.messages.value;
    if (startupMessages.length > 0) {
      return {
        kind: "startup-alert",
        messages: startupMessages
      };
    }

    const conflict = options.save.conflict.value;
    if (conflict) {
      return {
        kind: "save-conflict",
        title: conflict.payload.title,
        draftContent: conflict.payload.content,
        diskContent: conflict.diskContent,
        submitting: options.save.submitting.value
      };
    }

    const expertCreation = options.shortStructure.expertCreation.value;
    if (expertCreation) {
      return {
        kind: "create-expert-section",
        suggestedTitle: expertCreation.suggestedTitle,
        workspaceType: expertCreation.workspaceType,
        pending: options.catalog.mutationPending.value
      };
    }

    const expertDeletion = options.shortStructure.expertDeletion.value;
    if (expertDeletion) {
      return {
        kind: "delete-expert-section",
        sectionTitle: expertDeletion.sectionTitle,
        hasContent: expertDeletion.hasContent,
        workspaceType: expertDeletion.workspaceType
      };
    }

    const continuationPreview = options.longLifecycle.continuationPreview.value;
    if (continuationPreview) {
      return {
        kind: "continuation-import",
        preview: continuationPreview,
        submitting: options.longLifecycle.mutationPending.value
      };
    }

    const legacyPreview = options.longLifecycle.legacyPreview.value;
    const legacyResult = options.longLifecycle.legacyResult.value;
    if (legacyPreview || legacyResult) {
      return {
        kind: "legacy-sync",
        preview: legacyPreview,
        result: legacyResult,
        pending: options.longLifecycle.mutationPending.value
      };
    }

    const characterCreation = options.longStructure.characterCreation.value;
    if (characterCreation) {
      return {
        kind: "create-long-character",
        groupLabel: characterCreation.groupLabel,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const worldbuildingItemCreation =
      options.longStructure.worldbuildingItemCreation.value;
    if (worldbuildingItemCreation) {
      return {
        kind: "create-long-worldbuilding-item",
        categoryTitle: worldbuildingItemCreation.categoryTitle,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const plotPointCreation = options.longStructure.plotPointCreation.value;
    if (plotPointCreation) {
      return {
        kind: "create-long-plot-point",
        volumeTitle: plotPointCreation.volumeTitle,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const chapterCardCreation = options.longStructure.chapterCardCreation.value;
    if (chapterCardCreation) {
      return {
        kind: "create-long-chapter-card",
        volumeTitle: chapterCardCreation.volumeTitle,
        arcOptions: chapterCardCreation.arcOptions,
        source: chapterCardCreation.source,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const draftDeletion = options.longStructure.draftDeletion.value;
    if (draftDeletion) {
      return {
        kind: "delete-long-draft",
        sectionTitle: draftDeletion.title,
        description: draftDeletion.description,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const treeDeletion = options.longStructure.treeDeletion.value;
    if (treeDeletion) {
      return {
        kind: "delete-long-tree",
        sectionTitle: treeDeletion.title,
        itemLabel: treeDeletion.label,
        description: treeDeletion.description,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const ledgerCommitDeletion =
      options.longStructure.ledgerCommitDeletion.value;
    if (ledgerCommitDeletion) {
      return {
        kind: "delete-long-ledger-commit",
        title: ledgerCommitDeletion.title,
        chapterCount: ledgerCommitDeletion.chapterCardIds.length,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const volumeCreation = options.longStructure.volumeCreation.value;
    if (volumeCreation) {
      return {
        kind: "create-long-volume",
        source: volumeCreation.source,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const bindingsMode = options.longLifecycle.bindingsMode.value;
    if (bindingsMode) {
      const summary = options.longLifecycle.activeBookSummary.value;
      if (summary) {
        const snapshot = options.catalog.snapshot.value;
        return {
          kind: "long-bindings",
          mode: bindingsMode,
          bookTitle: summary.title,
          materials: snapshot?.materials ?? [],
          skills: snapshot?.skills ?? [],
          linkedMaterialIdsByKind: summary.linkedMaterialIdsByKind,
          linkedSkillIdsByKind: summary.linkedSkillIdsByKind,
          linkedResourceStageScopes: summary.linkedResourceStageScopes ?? {
            materials: {},
            skills: {}
          },
          submitting: options.longLifecycle.bookActionPending.value
        };
      }
    }

    const renameTarget = options.longLifecycle.renameTarget.value;
    if (renameTarget) {
      return {
        kind: "long-rename",
        title: renameTarget.title,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const removalTarget = options.longLifecycle.removalTarget.value;
    if (removalTarget) {
      return {
        kind: "long-removal",
        action: removalTarget.action,
        title: removalTarget.title,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    if (options.longStructure.dialogOpen.value) {
      return {
        kind: "long-structure",
        bookTitle: options.longLifecycle.activeBookSummary.value?.title ?? "",
        bookId: options.longLifecycle.activeBookId.value,
        agentsMd: options.longStructure.agentsMd.value,
        agentsMdPending: options.longStructure.agentsMdPending.value,
        syncBookOptions: options.longStructure.syncBookOptions.value,
        snapshot: options.longLifecycle.workspaceIndex.value,
        pending: options.longLifecycle.bookActionPending.value
      };
    }

    const characterDialog = options.shortStructure.characterDialog.value;
    if (characterDialog) {
      return {
        kind: "character-item",
        mode: characterDialog.mode,
        title: characterDialog.title,
        pending: options.catalog.mutationPending.value
      };
    }

    if (options.shortStructure.plotBookId.value) {
      return {
        kind: "plot-structure",
        book: options.shortStructure.plotBook.value,
        pending: options.catalog.mutationPending.value,
        writingContext: options.shortStructure.writingContext?.value ?? null,
        writingContextLoading:
          options.shortStructure.writingContextLoading?.value ?? false,
        writingContextPending:
          options.shortStructure.writingContextPending?.value ?? false
      };
    }

    const shortExportTarget = options.shortLifecycle.exportTarget.value;
    if (shortExportTarget) {
      return {
        kind: "export-short",
        bookTitle: shortExportTarget.label,
        workspaceType: shortExportTarget.workspaceType,
        submitting: options.shortLifecycle.manuscriptExportPending.value
      };
    }

    const longExportTarget = options.longLifecycle.exportTarget.value;
    if (longExportTarget) {
      return {
        kind: "export-long",
        bookTitle: longExportTarget.title,
        submitting: options.longLifecycle.manuscriptExportPending.value
      };
    }

    const libraryRemoval = options.library.removalDialog.value;
    if (libraryRemoval) {
      return {
        kind: "library-removal",
        action: libraryRemoval.action,
        domain: libraryRemoval.payload.domain,
        label: libraryRemoval.payload.node.label,
        submitting: options.catalog.mutationPending.value
      };
    }

    const libraryProject = options.library.projectDialog.value;
    if (libraryProject) {
      return {
        kind: "library-project",
        operation: libraryProject.operation,
        domain: libraryProject.domain,
        ...(libraryProject.libraryId
          ? { libraryId: libraryProject.libraryId }
          : {}),
        ...(libraryProject.libraryTitle
          ? { libraryTitle: libraryProject.libraryTitle }
          : {}),
        ...(libraryProject.materialKind
          ? { materialKind: libraryProject.materialKind }
          : {}),
        ...(libraryProject.entryId ? { entryId: libraryProject.entryId } : {}),
        ...(libraryProject.entryTitle
          ? { entryTitle: libraryProject.entryTitle }
          : {}),
        ...(libraryProject.workspaceType
          ? { workspaceType: libraryProject.workspaceType }
          : {}),
        submitting: options.catalog.mutationPending.value
      };
    }

    const externalSkillImport = options.library.externalSkillImportDialog.value;
    if (externalSkillImport) {
      return {
        kind: "external-skill-import",
        libraryTitle: externalSkillImport.libraryTitle,
        pending: options.catalog.mutationPending.value
      };
    }

    const entryMove = options.library.entryMove.value;
    if (entryMove) {
      return {
        kind: "library-entry-move",
        entryTitle: entryMove.entryTitle,
        targetLibraryTitle: entryMove.targetLibraryTitle,
        options: options.catalog.materialStageOptions(
          entryMove.targetMaterialKind
        ),
        initialStageId: entryMove.initialStageId,
        submitting: options.catalog.mutationPending.value
      };
    }

    const groupDialog = options.library.groupDialog.value;
    if (groupDialog) {
      const snapshot = options.catalog.snapshot.value;
      return {
        kind: "library-group",
        domain: groupDialog.domain,
        group: options.library.activeGroup.value,
        materials: snapshot?.materials ?? [],
        materialGroups: snapshot?.materialGroups ?? [],
        skills: snapshot?.skills ?? [],
        skillGroups: snapshot?.skillGroups ?? [],
        submitting: options.catalog.mutationPending.value
      };
    }

    if (options.shortLifecycle.createDialogOpen.value) {
      const snapshot = options.catalog.snapshot.value;
      return {
        kind: "create-book",
        materials: snapshot?.materials ?? [],
        materialGroups: snapshot?.materialGroups ?? [],
        skills: snapshot?.skills ?? [],
        skillGroups: snapshot?.skillGroups ?? [],
        loading: options.catalog.loading.value,
        submitting:
          options.catalog.mutationPending.value ||
          options.longLifecycle.mutationPending.value
      };
    }

    const transferMode = options.shortLifecycle.transferMode.value;
    if (transferMode) {
      return {
        kind: "book-transfer",
        mode: transferMode,
        pending:
          options.catalog.mutationPending.value ||
          options.longLifecycle.mutationPending.value
      };
    }

    const resourceMode = options.shortLifecycle.resourceMode.value;
    if (resourceMode) {
      const snapshot = options.catalog.snapshot.value;
      return {
        kind: "book-resource",
        mode: resourceMode,
        book: options.shortLifecycle.activeBookTarget.value?.node ?? null,
        skillLibraries: options.catalog.skillLibraries.value,
        materialLibraries: options.catalog.materialLibraries.value,
        materialGroups: snapshot?.materialGroups ?? [],
        skillGroups: snapshot?.skillGroups ?? [],
        loading: options.catalog.loading.value,
        submitting: options.catalog.mutationPending.value
      };
    }

    return null;
  });
}
