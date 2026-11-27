import { drainLoadedCoordinator } from "./book-lifecycle-operations";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { Ref } from "vue";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import type {
  LongStructureTransactionsCoordinator,
  LongStructureTransactionsCoordinatorOptions
} from "./useLongStructureTransactionsCoordinator";

const t = createScopedTranslator(
  "workspace.lazyLongStructureTransactionsCoordinator"
);

export interface LongStructureTransactionsCoordinatorModule {
  useLongStructureTransactionsCoordinator(
    options: LongStructureTransactionsCoordinatorOptions
  ): LongStructureTransactionsCoordinator;
}

export type LongStructureTransactionsCoordinatorModuleLoader =
  () => Promise<LongStructureTransactionsCoordinatorModule>;

function loadLongStructureTransactionsCoordinatorModule(): Promise<LongStructureTransactionsCoordinatorModule> {
  return import("./useLongStructureTransactionsCoordinator");
}

type Coordinator = LongStructureTransactionsCoordinator;
type Guard = () => boolean;
type Skipped = (message: string) => void;

const CANCELED_MESSAGE = t("theLongFormStructureOperationWasCanceled");
const LOAD_FAILURE_MESSAGE = t("couldNotLoadTheLongFormStructureCoordinator");
const MIGRATION_EVIDENCE_CATEGORY_PREFIX = "world_migration-evidence-";

/**
 * Keeps the synchronous dialog state and book-option projection app-ready,
 * while the 2k-line transaction implementation and its runtime helpers remain
 * behind one shared dynamic import.
 */
export function useLazyLongStructureTransactionsCoordinator(
  context: LongStructureTransactionsCoordinatorOptions,
  loadModule: LongStructureTransactionsCoordinatorModuleLoader = loadLongStructureTransactionsCoordinatorModule
): LongStructureTransactionsCoordinator {
  const { state } = context;
  const longWorldbuildingSyncBookOptions = computed<
    LongWorldbuildingSyncBookOption[]
  >(() =>
    state.longBooks.value.map((book) => ({
      id: book.id,
      title: book.title,
      categoryCount: book.navigation.worldbuilding.filter(
        ({ id }) => !id.startsWith(MIGRATION_EVIDENCE_CATEGORY_PREFIX)
      ).length
    }))
  );

  let coordinator: Coordinator | null = null;
  let coordinatorPromise: Promise<Coordinator | null> | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let dialogIntentEpoch = 0;
  let loadFailureReported = false;

  function loadCoordinator(): Promise<Coordinator | null> {
    if (disposed) return Promise.resolve(null);
    if (coordinator) return Promise.resolve(coordinator);
    if (coordinatorPromise) return coordinatorPromise;
    loadFailureReported = false;
    const loading = loadModule()
      .then(async ({ useLongStructureTransactionsCoordinator }) => {
        const loaded = useLongStructureTransactionsCoordinator(context);
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
    context.notifications.error(formatError(error, LOAD_FAILURE_MESSAGE));
  }

  function reportVoidFailure(error: unknown): void {
    if (disposed) return;
    context.notifications.error(
      formatError(error, t("theLongFormStructureOperationFailed"))
    );
  }

  async function invoke(
    operation: (loaded: Coordinator) => void | Promise<void>,
    guard: Guard = () => true,
    skipped?: Skipped
  ): Promise<void> {
    if (disposed) {
      skipped?.(CANCELED_MESSAGE);
      return;
    }
    let loaded: Coordinator | null;
    try {
      loaded = await loadCoordinator();
    } catch (error: unknown) {
      reportLoadFailure(error);
      skipped?.(LOAD_FAILURE_MESSAGE);
      return;
    }
    if (!loaded || disposed || !guard()) {
      skipped?.(CANCELED_MESSAGE);
      return;
    }
    await operation(loaded);
  }

  function issueVoid(task: () => Promise<void>): void {
    void task().catch(reportVoidFailure);
  }

  function beginDialogIntent(): number {
    return ++dialogIntentEpoch;
  }

  function captureDialogGuard(
    requestId = dialogIntentEpoch,
    targetGuard: Guard = () => true
  ): Guard {
    return () => !disposed && dialogIntentEpoch === requestId && targetGuard();
  }

  function captureActiveBookGuard(): Guard {
    const bookId = state.activeBookId.value;
    return () => state.activeBookId.value === bookId;
  }

  function captureMutationTargetGuard(): Guard {
    const bookId = state.activeBookId.value;
    const index = state.workspaceIndex.value;
    return () =>
      state.activeBookId.value === bookId &&
      state.workspaceIndex.value === index;
  }

  function captureRefTargetGuard<Value>(targetRef: Ref<Value | null>): Guard {
    const target = targetRef.value;
    return () => target !== null && targetRef.value === target;
  }

  function closeSynchronously(
    clear: () => void,
    closeLoaded: (loaded: Coordinator) => void
  ): void {
    if (disposed || state.mutationPending.value) return;
    dialogIntentEpoch += 1;
    clear();
    if (!coordinator) return;
    try {
      closeLoaded(coordinator);
    } catch (error: unknown) {
      reportVoidFailure(error);
    }
  }

  function requestCreateLongDraftSection(
    ...args: Parameters<Coordinator["requestCreateLongDraftSection"]>
  ): ReturnType<Coordinator["requestCreateLongDraftSection"]> {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.requestCreateLongDraftSection(...args),
      captureDialogGuard(requestId)
    ).catch(reportVoidFailure);
  }

  function handleLongDraftSectionAction(
    ...args: Parameters<Coordinator["handleLongDraftSectionAction"]>
  ): ReturnType<Coordinator["handleLongDraftSectionAction"]> {
    return invoke(
      (loaded) => loaded.handleLongDraftSectionAction(...args),
      captureDialogGuard()
    );
  }

  function handleCreateLongTreeItem(
    ...args: Parameters<Coordinator["handleCreateLongTreeItem"]>
  ): ReturnType<Coordinator["handleCreateLongTreeItem"]> {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.handleCreateLongTreeItem(...args),
      captureDialogGuard(requestId)
    );
  }

  function handleLongTreeItemAction(
    ...args: Parameters<Coordinator["handleLongTreeItemAction"]>
  ): ReturnType<Coordinator["handleLongTreeItemAction"]> {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.handleLongTreeItemAction(...args),
      captureDialogGuard(requestId)
    );
  }

  function handleReorderLongTreeNode(
    ...args: Parameters<Coordinator["handleReorderLongTreeNode"]>
  ): ReturnType<Coordinator["handleReorderLongTreeNode"]> {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.handleReorderLongTreeNode(...args),
      captureDialogGuard(requestId)
    );
  }

  function confirmDeleteLongTreeItem(): ReturnType<
    Coordinator["confirmDeleteLongTreeItem"]
  > {
    return invoke(
      (loaded) => loaded.confirmDeleteLongTreeItem(),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.treeItemDeleteTarget)
      )
    );
  }

  function confirmDeleteLongDraftSection(): ReturnType<
    Coordinator["confirmDeleteLongDraftSection"]
  > {
    return invoke(
      (loaded) => loaded.confirmDeleteLongDraftSection(),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.draftSectionDeleteTarget)
      )
    );
  }

  function renameLongCharacter(
    ...args: Parameters<Coordinator["renameLongCharacter"]>
  ): ReturnType<Coordinator["renameLongCharacter"]> {
    return invoke(
      (loaded) => loaded.renameLongCharacter(...args),
      captureActiveBookGuard(),
      () => args[1](false)
    );
  }

  function renameLongStructureTitle(
    ...args: Parameters<Coordinator["renameLongStructureTitle"]>
  ): ReturnType<Coordinator["renameLongStructureTitle"]> {
    return invoke(
      (loaded) => loaded.renameLongStructureTitle(...args),
      captureActiveBookGuard(),
      () => args[1](false)
    );
  }

  function openLongCharacterCreate(): void {
    const requestId = beginDialogIntent();
    issueVoid(() =>
      invoke(
        (loaded) => loaded.openLongCharacterCreate(),
        captureDialogGuard(requestId)
      )
    );
  }

  function openLongWorldbuildingItemCreate(): ReturnType<
    Coordinator["openLongWorldbuildingItemCreate"]
  > {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.openLongWorldbuildingItemCreate(),
      captureDialogGuard(requestId)
    );
  }

  function openLongVolumeCreate(): ReturnType<
    Coordinator["openLongVolumeCreate"]
  > {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.openLongVolumeCreate(),
      captureDialogGuard(requestId)
    );
  }

  function openLongPlotPointCreate(): ReturnType<
    Coordinator["openLongPlotPointCreate"]
  > {
    const requestId = beginDialogIntent();
    return invoke(
      (loaded) => loaded.openLongPlotPointCreate(),
      captureDialogGuard(requestId)
    );
  }

  function saveLongVolumeOutline(
    ...args: Parameters<Coordinator["saveLongVolumeOutline"]>
  ): ReturnType<Coordinator["saveLongVolumeOutline"]> {
    return invoke(
      (loaded) => loaded.saveLongVolumeOutline(...args),
      captureActiveBookGuard(),
      () => args[1](false)
    );
  }

  function saveLongPlotPointContent(
    ...args: Parameters<Coordinator["saveLongPlotPointContent"]>
  ): ReturnType<Coordinator["saveLongPlotPointContent"]> {
    return invoke(
      (loaded) => loaded.saveLongPlotPointContent(...args),
      captureActiveBookGuard(),
      () => args[1](false)
    );
  }

  function createLongVolume(
    ...args: Parameters<Coordinator["createLongVolume"]>
  ): ReturnType<Coordinator["createLongVolume"]> {
    return invoke(
      (loaded) => loaded.createLongVolume(...args),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.volumeCreateTarget)
      )
    );
  }

  function createLongWorldbuildingItem(
    ...args: Parameters<Coordinator["createLongWorldbuildingItem"]>
  ): ReturnType<Coordinator["createLongWorldbuildingItem"]> {
    return invoke(
      (loaded) => loaded.createLongWorldbuildingItem(...args),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.worldbuildingItemCreateTarget)
      )
    );
  }

  function createLongPlotPoint(
    ...args: Parameters<Coordinator["createLongPlotPoint"]>
  ): ReturnType<Coordinator["createLongPlotPoint"]> {
    return invoke(
      (loaded) => loaded.createLongPlotPoint(...args),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.plotPointCreateTarget)
      )
    );
  }

  function createLongChapterCard(
    ...args: Parameters<Coordinator["createLongChapterCard"]>
  ): ReturnType<Coordinator["createLongChapterCard"]> {
    return invoke(
      (loaded) => loaded.createLongChapterCard(...args),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.chapterCardCreateTarget)
      )
    );
  }

  function handleLongStructureMutation(
    ...args: Parameters<Coordinator["handleLongStructureMutation"]>
  ): ReturnType<Coordinator["handleLongStructureMutation"]> {
    return invoke(
      (loaded) => loaded.handleLongStructureMutation(...args),
      captureMutationTargetGuard(),
      (message) => args[2].fail(message)
    );
  }

  function handleActiveLongStructureMutation(
    ...args: Parameters<Coordinator["handleActiveLongStructureMutation"]>
  ): ReturnType<Coordinator["handleActiveLongStructureMutation"]> {
    return invoke(
      (loaded) => loaded.handleActiveLongStructureMutation(...args),
      captureMutationTargetGuard(),
      (message) => args[1].fail(message)
    );
  }

  function previewActiveLongStructureMutation(
    ...args: Parameters<Coordinator["previewActiveLongStructureMutation"]>
  ): ReturnType<Coordinator["previewActiveLongStructureMutation"]> {
    return invoke(
      (loaded) => loaded.previewActiveLongStructureMutation(...args),
      captureMutationTargetGuard(),
      () => args[1]()
    );
  }

  function handleLongWorldbuildingSync(
    ...args: Parameters<Coordinator["handleLongWorldbuildingSync"]>
  ): ReturnType<Coordinator["handleLongWorldbuildingSync"]> {
    return invoke(
      (loaded) => loaded.handleLongWorldbuildingSync(...args),
      captureDialogGuard(dialogIntentEpoch, captureActiveBookGuard()),
      (message) => args[1].fail(message)
    );
  }

  function deleteActiveLongNavigationStructure(
    ...args: Parameters<Coordinator["deleteActiveLongNavigationStructure"]>
  ): ReturnType<Coordinator["deleteActiveLongNavigationStructure"]> {
    return invoke(
      (loaded) => loaded.deleteActiveLongNavigationStructure(...args),
      captureActiveBookGuard(),
      () => args[1](false)
    );
  }

  function previewActiveLongNavigationStructure(
    ...args: Parameters<Coordinator["previewActiveLongNavigationStructure"]>
  ): ReturnType<Coordinator["previewActiveLongNavigationStructure"]> {
    return invoke(
      (loaded) => loaded.previewActiveLongNavigationStructure(...args),
      captureActiveBookGuard(),
      () => args[1]()
    );
  }

  function createLongCharacter(
    ...args: Parameters<Coordinator["createLongCharacter"]>
  ): ReturnType<Coordinator["createLongCharacter"]> {
    return invoke(
      (loaded) => loaded.createLongCharacter(...args),
      captureDialogGuard(
        dialogIntentEpoch,
        captureRefTargetGuard(state.characterCreateTarget)
      )
    );
  }

  function closeLongStructureDialog(): void {
    closeSynchronously(
      () => {
        state.structureDialogOpen.value = false;
      },
      (loaded) => loaded.closeLongStructureDialog()
    );
  }

  function closeLongCharacterCreate(): void {
    closeSynchronously(
      () => {
        state.characterCreateTarget.value = null;
      },
      (loaded) => loaded.closeLongCharacterCreate()
    );
  }

  function closeLongWorldbuildingItemCreate(): void {
    closeSynchronously(
      () => {
        state.worldbuildingItemCreateTarget.value = null;
      },
      (loaded) => loaded.closeLongWorldbuildingItemCreate()
    );
  }

  function closeLongPlotPointCreate(): void {
    closeSynchronously(
      () => {
        state.plotPointCreateTarget.value = null;
      },
      (loaded) => loaded.closeLongPlotPointCreate()
    );
  }

  function closeLongChapterCardCreate(): void {
    closeSynchronously(
      () => {
        state.chapterCardCreateTarget.value = null;
      },
      (loaded) => loaded.closeLongChapterCardCreate()
    );
  }

  function closeLongDraftSectionDelete(): void {
    closeSynchronously(
      () => {
        state.draftSectionDeleteTarget.value = null;
      },
      (loaded) => loaded.closeLongDraftSectionDelete()
    );
  }

  function closeLongTreeItemDelete(): void {
    closeSynchronously(
      () => {
        state.treeItemDeleteTarget.value = null;
      },
      (loaded) => loaded.closeLongTreeItemDelete()
    );
  }

  function closeLongVolumeCreate(): void {
    closeSynchronously(
      () => {
        state.volumeCreateTarget.value = null;
      },
      (loaded) => loaded.closeLongVolumeCreate()
    );
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
    dialogIntentEpoch += 1;
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
        // Lazy chunk failure must not block the remaining cleanup stack.
      }
    })();
    return disposePromise;
  }

  return {
    longWorldbuildingSyncBookOptions,
    requestCreateLongDraftSection,
    handleLongDraftSectionAction,
    handleCreateLongTreeItem,
    handleLongTreeItemAction,
    handleReorderLongTreeNode,
    confirmDeleteLongTreeItem,
    confirmDeleteLongDraftSection,
    renameLongCharacter,
    renameLongStructureTitle,
    openLongCharacterCreate,
    openLongWorldbuildingItemCreate,
    openLongVolumeCreate,
    openLongPlotPointCreate,
    saveLongVolumeOutline,
    saveLongPlotPointContent,
    createLongVolume,
    createLongWorldbuildingItem,
    createLongPlotPoint,
    createLongChapterCard,
    handleLongStructureMutation,
    handleActiveLongStructureMutation,
    previewActiveLongStructureMutation,
    handleLongWorldbuildingSync,
    previewActiveLongNavigationStructure,
    deleteActiveLongNavigationStructure,
    createLongCharacter,
    closeLongStructureDialog,
    closeLongCharacterCreate,
    closeLongWorldbuildingItemCreate,
    closeLongPlotPointCreate,
    closeLongChapterCardCreate,
    closeLongDraftSectionDelete,
    closeLongTreeItemDelete,
    closeLongVolumeCreate,
    drain,
    dispose
  };
}
