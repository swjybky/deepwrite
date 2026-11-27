import { drainLoadedCoordinator } from "./book-lifecycle-operations";
import { formatError } from "../i18n/errors";
import { t } from "../i18n";
import type {
  CreateLongBookInput,
  LongImportContinuationInput,
  LongLegacySyncModule,
  LongOpenBookResult
} from "@deepwrite/contracts";
import type { LongBookResourceNodeActionPayload } from "../types/workspace";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import type { LongManuscriptExportRequest } from "../utils/longManuscriptExport";
import type {
  LongBookLifecycleCoordinator,
  LongBookLifecycleCoordinatorOptions
} from "./useLongBookLifecycleCoordinator";

export interface LongBookLifecycleModule {
  useLongBookLifecycleCoordinator(
    options: LongBookLifecycleCoordinatorOptions
  ): LongBookLifecycleCoordinator;
}

export type LongBookLifecycleModuleLoader =
  () => Promise<LongBookLifecycleModule>;

export interface LazyLongBookLifecycleCoordinator {
  activateLongBookWorkspace(opened: LongOpenBookResult): Promise<void>;
  createLongBook(input: CreateLongBookInput): Promise<void>;
  openExistingLongBook(): Promise<void>;
  chooseContinuationImportSource(): Promise<void>;
  importPortableLongBook(): Promise<void>;
  confirmContinuationImport(input: LongImportContinuationInput): Promise<void>;
  closeContinuationImportDialog(): void;
  handleLongBookAction(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void>;
  closeLegacySyncDialog(): void;
  confirmLegacySync(modules: LongLegacySyncModule[]): Promise<void>;
  closeLongExportDialog(): void;
  exportLongBookManuscript(request: LongManuscriptExportRequest): Promise<void>;
  closeLongBookRenameDialog(): void;
  renameLongBook(title: string): Promise<void>;
  closeLongBookRemovalDialog(): void;
  confirmLongBookRemoval(): Promise<void>;
  saveLongAgentsMd(
    content: string,
    completion: LongStructureMutationCompletion
  ): Promise<void>;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

function loadLongBookLifecycleModule(): Promise<LongBookLifecycleModule> {
  return import("./useLongBookLifecycleCoordinator");
}

/**
 * Defers the whole-book lifecycle implementation until the first lifecycle
 * action. Dialog closes remain synchronous and never cause a module load.
 */
export function useLazyLongBookLifecycleCoordinator(
  context: LongBookLifecycleCoordinatorOptions,
  loadModule: LongBookLifecycleModuleLoader = loadLongBookLifecycleModule
): LazyLongBookLifecycleCoordinator {
  let coordinator: LongBookLifecycleCoordinator | null = null;
  let coordinatorPromise: Promise<LongBookLifecycleCoordinator | null> | null =
    null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let dialogIntentEpoch = 0;
  let loadFailureReported = false;

  function loadCoordinator(): Promise<LongBookLifecycleCoordinator | null> {
    if (disposed) return Promise.resolve(null);
    if (coordinator) return Promise.resolve(coordinator);
    if (coordinatorPromise) return coordinatorPromise;
    loadFailureReported = false;
    const loading = loadModule()
      .then(async ({ useLongBookLifecycleCoordinator }) => {
        const loaded = useLongBookLifecycleCoordinator(context);
        coordinator = loaded;
        if (disposed) {
          await loaded.dispose();
          return null;
        }
        return loaded;
      })
      .catch((error: unknown) => {
        if (coordinatorPromise === loading) coordinatorPromise = null;
        throw error;
      });
    coordinatorPromise = loading;
    return loading;
  }

  function reportLoadFailure(error: unknown): void {
    if (disposed || loadFailureReported) return;
    loadFailureReported = true;
    context.notifications.error(
      formatError(
        error,
        t(
          "workspace.lazyLongBookLifecycleCoordinator.failedToLoadTheNovelLifecycleCoordinator"
        )
      )
    );
  }

  function invoke(
    operation: (loaded: LongBookLifecycleCoordinator) => void | Promise<void>,
    expectedDialogIntent?: number
  ): Promise<void> {
    if (disposed) return Promise.resolve();
    return loadCoordinator()
      .then(async (loaded) => {
        if (
          !loaded ||
          disposed ||
          (expectedDialogIntent !== undefined &&
            expectedDialogIntent !== dialogIntentEpoch)
        ) {
          return;
        }
        await operation(loaded);
      })
      .catch(reportLoadFailure);
  }

  function dialogIntent(): number {
    return dialogIntentEpoch;
  }

  function cancelDialogIntent(): void {
    dialogIntentEpoch += 1;
  }

  function activateLongBookWorkspace(
    opened: LongOpenBookResult
  ): Promise<void> {
    return invoke((loaded) => loaded.activateLongBookWorkspace(opened));
  }

  function createLongBook(input: CreateLongBookInput): Promise<void> {
    return invoke((loaded) => loaded.createLongBook(input));
  }

  function openExistingLongBook(): Promise<void> {
    return invoke((loaded) => loaded.openExistingLongBook());
  }

  function chooseContinuationImportSource(): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.chooseContinuationImportSource(), intent);
  }

  function importPortableLongBook(): Promise<void> {
    return invoke((loaded) => loaded.importPortableLongBook());
  }

  function confirmContinuationImport(
    input: LongImportContinuationInput
  ): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.confirmContinuationImport(input), intent);
  }

  function closeContinuationImportDialog(): void {
    if (disposed) return;
    cancelDialogIntent();
    if (coordinator) {
      coordinator.closeContinuationImportDialog();
      return;
    }
    if (!context.state.mutationPending.value) {
      context.state.continuationImportPreview.value = null;
    }
  }

  function handleLongBookAction(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    const intentSensitive = payload.action !== "duplicate";
    const intent = intentSensitive ? dialogIntent() : undefined;
    return invoke((loaded) => loaded.handleLongBookAction(payload), intent);
  }

  function closeLegacySyncDialog(): void {
    if (disposed) return;
    cancelDialogIntent();
    if (coordinator) {
      coordinator.closeLegacySyncDialog();
      return;
    }
    if (!context.state.mutationPending.value) {
      context.state.legacySyncPreview.value = null;
      context.state.legacySyncResult.value = null;
    }
  }

  function confirmLegacySync(modules: LongLegacySyncModule[]): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.confirmLegacySync(modules), intent);
  }

  function closeLongExportDialog(): void {
    if (disposed) return;
    cancelDialogIntent();
    if (coordinator) {
      coordinator.closeLongExportDialog();
      return;
    }
    if (!context.state.manuscriptExportPending.value) {
      context.state.exportTarget.value = null;
    }
  }

  function exportLongBookManuscript(
    request: LongManuscriptExportRequest
  ): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.exportLongBookManuscript(request), intent);
  }

  function closeLongBookRenameDialog(): void {
    if (disposed) return;
    cancelDialogIntent();
    if (coordinator) {
      coordinator.closeLongBookRenameDialog();
      return;
    }
    context.state.bookRenameTarget.value = null;
  }

  function renameLongBook(title: string): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.renameLongBook(title), intent);
  }

  function closeLongBookRemovalDialog(): void {
    if (disposed) return;
    cancelDialogIntent();
    if (coordinator) {
      coordinator.closeLongBookRemovalDialog();
      return;
    }
    context.state.bookRemovalTarget.value = null;
  }

  function confirmLongBookRemoval(): Promise<void> {
    const intent = dialogIntent();
    return invoke((loaded) => loaded.confirmLongBookRemoval(), intent);
  }

  function saveLongAgentsMd(
    content: string,
    completion: LongStructureMutationCompletion
  ): Promise<void> {
    return invoke((loaded) => loaded.saveLongAgentsMd(content, completion));
  }

  function drain(): Promise<void> {
    return drainLoadedCoordinator(
      disposePromise,
      coordinator,
      coordinatorPromise,
      reportLoadFailure
    );
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    cancelDialogIntent();
    const loading = coordinatorPromise;
    disposePromise = (async () => {
      if (coordinator) {
        await coordinator.dispose();
        return;
      }
      if (!loading) return;
      try {
        const loaded = await loading;
        await loaded?.dispose();
      } catch {
        // Teardown stays safe when a lazily loaded chunk fails to resolve.
      }
    })();
    return disposePromise;
  }

  return {
    activateLongBookWorkspace,
    createLongBook,
    openExistingLongBook,
    chooseContinuationImportSource,
    importPortableLongBook,
    confirmContinuationImport,
    closeContinuationImportDialog,
    handleLongBookAction,
    closeLegacySyncDialog,
    confirmLegacySync,
    closeLongExportDialog,
    exportLongBookManuscript,
    closeLongBookRenameDialog,
    renameLongBook,
    closeLongBookRemovalDialog,
    confirmLongBookRemoval,
    saveLongAgentsMd,
    drain,
    dispose
  };
}
