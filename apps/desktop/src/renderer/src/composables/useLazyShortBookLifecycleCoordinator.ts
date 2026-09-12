import {
  getCurrentInstance,
  provide,
  ref,
  shallowRef,
  type Ref,
  type ShallowRef
} from "vue";
import { SHORT_MANUSCRIPT_PREVIEW_KEY } from "./shortManuscriptPreviewContext";
import type {
  BookResourceDialogMode,
  ResourceTreeNode
} from "../types/workspace";
import type { ShortManuscriptExportTarget } from "../utils/shortManuscriptExport";
import type {
  CreateShortOrScriptBookInput,
  ShortBookBindingsUpdate,
  ShortBookLifecycleCoordinator,
  ShortBookLifecycleCoordinatorOptions,
  ShortBookLifecycleState,
  ShortBookLifecycleTarget
} from "./useShortBookLifecycleCoordinator";

type FacadeOwnedStateKey =
  | "dialogIntent"
  | "bookDialogMode"
  | "activeBook"
  | "exportBookTarget"
  | "manuscriptExportPending";

export type LazyShortBookLifecycleCoordinatorOptions = Omit<
  ShortBookLifecycleCoordinatorOptions,
  "state"
> & {
  state: Omit<ShortBookLifecycleState, FacadeOwnedStateKey>;
};

export interface ShortBookLifecycleModule {
  useShortBookLifecycleCoordinator(
    options: ShortBookLifecycleCoordinatorOptions
  ): ShortBookLifecycleCoordinator;
}

export type ShortBookLifecycleModuleLoader =
  () => Promise<ShortBookLifecycleModule>;

export interface LazyShortBookLifecycleCoordinator {
  readonly dialogIntent: Ref<number>;
  readonly bookDialogMode: Ref<BookResourceDialogMode | null>;
  readonly activeBook: ShallowRef<ShortBookLifecycleTarget | null>;
  readonly exportBookTarget: ShallowRef<ShortBookLifecycleTarget | null>;
  readonly manuscriptExportPending: Ref<boolean>;
  openBookDialog(
    mode: BookResourceDialogMode,
    book: ResourceTreeNode
  ): Promise<void>;
  closeBookDialog(): void;
  openBookExportDialog(book: ResourceTreeNode): void;
  closeBookExportDialog(): void;
  createBook(input: CreateShortOrScriptBookInput): Promise<void>;
  renameBook(payload: { bookId: string; label: string }): Promise<void>;
  updateBookBindings(payload: ShortBookBindingsUpdate): Promise<void>;
  removeBook(bookId: string): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
  exportBookManuscript(target: ShortManuscriptExportTarget): Promise<void>;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

function loadShortBookLifecycleModule(): Promise<ShortBookLifecycleModule> {
  return import("./useShortBookLifecycleCoordinator");
}

function collectResourceIds(node: ResourceTreeNode): string[] {
  return [
    node.id,
    ...(node.children?.flatMap((child) => collectResourceIds(child)) ?? [])
  ];
}

function snapshotNode(node: ResourceTreeNode): Readonly<ResourceTreeNode> {
  // Dialogs and whole-book commands only consume root metadata. Omitting the
  // live children prevents a later projection refresh from changing the target.
  const { children: _children, ...root } = node;
  const snapshot: ResourceTreeNode = {
    ...root,
    ...(node.boundSkillLibraryIds
      ? { boundSkillLibraryIds: [...node.boundSkillLibraryIds] }
      : {}),
    ...(node.boundMaterialLibraryIds
      ? { boundMaterialLibraryIds: [...node.boundMaterialLibraryIds] }
      : {}),
    ...(node.boundSkillLibraryIdsByKind
      ? {
          boundSkillLibraryIdsByKind: {
            general: [...node.boundSkillLibraryIdsByKind.general],
            plot: [...node.boundSkillLibraryIdsByKind.plot],
            style: [...node.boundSkillLibraryIdsByKind.style],
            other: [...node.boundSkillLibraryIdsByKind.other]
          }
        }
      : {}),
    ...(node.boundMaterialLibraryIdsByKind
      ? {
          boundMaterialLibraryIdsByKind: {
            character: [...node.boundMaterialLibraryIdsByKind.character],
            gimmick: [...node.boundMaterialLibraryIdsByKind.gimmick],
            plot: [...node.boundMaterialLibraryIdsByKind.plot],
            draft: [...node.boundMaterialLibraryIdsByKind.draft],
            other: [...node.boundMaterialLibraryIdsByKind.other]
          }
        }
      : {})
  };
  return Object.freeze(snapshot);
}

function createTarget(
  node: ResourceTreeNode,
  requestId: number
): ShortBookLifecycleTarget {
  return Object.freeze({
    requestId,
    bookId: node.id,
    label: node.label,
    workspaceType: node.workspaceType === "script" ? "script" : "short",
    projectRevision: node.projectRevision,
    unavailable: node.unavailable === true,
    node: snapshotNode(node),
    resourceIds: Object.freeze(collectResourceIds(node))
  });
}

/**
 * Keeps dialog intent synchronous while deferring the transaction-heavy
 * lifecycle implementation until the first command that actually needs it.
 */
export function useLazyShortBookLifecycleCoordinator(
  options: LazyShortBookLifecycleCoordinatorOptions,
  loadModule: ShortBookLifecycleModuleLoader = loadShortBookLifecycleModule
): LazyShortBookLifecycleCoordinator {
  const dialogIntent = ref(0);
  const bookDialogMode = ref<BookResourceDialogMode | null>(null);
  const activeBook = shallowRef<ShortBookLifecycleTarget | null>(null);
  const exportBookTarget = shallowRef<ShortBookLifecycleTarget | null>(null);
  const manuscriptExportPending = ref(false);
  const state: ShortBookLifecycleState = {
    ...options.state,
    dialogIntent,
    bookDialogMode,
    activeBook,
    exportBookTarget,
    manuscriptExportPending
  };
  const coordinatorOptions: ShortBookLifecycleCoordinatorOptions = {
    ...options,
    state
  };

  if (getCurrentInstance()) {
    provide(SHORT_MANUSCRIPT_PREVIEW_KEY, {
      book: () => {
        const target = exportBookTarget.value;
        return target && !target.unavailable
          ? options.catalog.book(target.bookId)
          : undefined;
      },
      documents: state.documents,
      drafts: state.drafts,
      ensureDocumentsLoaded: options.manuscript.ensureDocumentsLoaded,
      reportError: (message) => options.notifications.error(message)
    });
  }

  let coordinator: ShortBookLifecycleCoordinator | null = null;
  let coordinatorPromise: Promise<ShortBookLifecycleCoordinator | null> | null =
    null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let loadFailureReported = false;

  function nextIntent(): number {
    dialogIntent.value += 1;
    return dialogIntent.value;
  }

  function intentIsCurrent(requestId: number): boolean {
    return !disposed && dialogIntent.value === requestId;
  }

  function loadCoordinator(): Promise<ShortBookLifecycleCoordinator | null> {
    if (disposed) return Promise.resolve(null);
    if (coordinator) return Promise.resolve(coordinator);
    if (coordinatorPromise) return coordinatorPromise;
    loadFailureReported = false;
    const loading = loadModule()
      .then(async ({ useShortBookLifecycleCoordinator }) => {
        const loaded = useShortBookLifecycleCoordinator(coordinatorOptions);
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
    options.notifications.error(
      error instanceof Error
        ? error.message
        : "加载短篇书籍生命周期协调器失败。"
    );
  }

  function invoke(
    operation: (loaded: ShortBookLifecycleCoordinator) => void | Promise<void>,
    expectedIntent?: number
  ): Promise<void> {
    if (disposed) return Promise.resolve();
    return loadCoordinator()
      .then(async (loaded) => {
        if (
          !loaded ||
          disposed ||
          (expectedIntent !== undefined && !intentIsCurrent(expectedIntent))
        ) {
          return;
        }
        await operation(loaded);
      })
      .catch(reportLoadFailure);
  }

  function openBookDialog(
    mode: BookResourceDialogMode,
    book: ResourceTreeNode
  ): Promise<void> {
    if (disposed) return Promise.resolve();
    const requestId = nextIntent();
    const target = createTarget(book, requestId);
    exportBookTarget.value = null;
    if (mode === "duplicate") {
      bookDialogMode.value = null;
      activeBook.value = null;
      return invoke((loaded) => loaded.duplicateBook(target), requestId);
    }
    if (mode === "manage-structure") {
      bookDialogMode.value = null;
      activeBook.value = target;
      return invoke((loaded) => loaded.manageStructure(target), requestId);
    }
    activeBook.value = target;
    bookDialogMode.value = mode;
    return Promise.resolve();
  }

  function closeBookDialog(): void {
    if (disposed || options.state.catalogMutationPending.value) return;
    nextIntent();
    bookDialogMode.value = null;
    activeBook.value = null;
  }

  function openBookExportDialog(book: ResourceTreeNode): void {
    if (disposed) return;
    const requestId = nextIntent();
    bookDialogMode.value = null;
    activeBook.value = null;
    exportBookTarget.value = createTarget(book, requestId);
  }

  function closeBookExportDialog(): void {
    if (disposed || manuscriptExportPending.value) return;
    nextIntent();
    exportBookTarget.value = null;
  }

  function createBook(input: CreateShortOrScriptBookInput): Promise<void> {
    return invoke((loaded) => loaded.createBook(input));
  }

  function renameBook(payload: {
    bookId: string;
    label: string;
  }): Promise<void> {
    const requestId = activeBook.value?.requestId;
    if (requestId === undefined) return Promise.resolve();
    return invoke((loaded) => loaded.renameBook(payload), requestId);
  }

  function updateBookBindings(payload: ShortBookBindingsUpdate): Promise<void> {
    const requestId = activeBook.value?.requestId;
    if (requestId === undefined) return Promise.resolve();
    return invoke((loaded) => loaded.updateBookBindings(payload), requestId);
  }

  function removeBook(bookId: string): Promise<void> {
    const requestId = activeBook.value?.requestId;
    if (requestId === undefined) return Promise.resolve();
    return invoke((loaded) => loaded.removeBook(bookId), requestId);
  }

  function deleteBook(bookId: string): Promise<void> {
    const requestId = activeBook.value?.requestId;
    if (requestId === undefined) return Promise.resolve();
    return invoke((loaded) => loaded.deleteBook(bookId), requestId);
  }

  function exportBookManuscript(
    target: ShortManuscriptExportTarget
  ): Promise<void> {
    const requestId = exportBookTarget.value?.requestId;
    if (requestId === undefined) return Promise.resolve();
    return invoke((loaded) => loaded.exportBookManuscript(target), requestId);
  }

  async function drain(): Promise<void> {
    if (coordinator) {
      await coordinator.drain();
      return;
    }
    if (!coordinatorPromise) return;
    try {
      const loaded = await coordinatorPromise;
      await loaded?.drain();
    } catch (error: unknown) {
      reportLoadFailure(error);
    }
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return;
    disposed = true;
    nextIntent();
    bookDialogMode.value = null;
    activeBook.value = null;
    exportBookTarget.value = null;
    disposePromise = (async () => {
      if (coordinator) {
        await coordinator.dispose();
        return;
      }
      if (coordinatorPromise) {
        try {
          await coordinatorPromise;
        } catch {
          // A command reports module-load failure through `invoke`. Disposal is
          // best-effort and must remain safe while that same load is rejecting.
        }
      }
    })();
    await disposePromise;
  }

  return {
    dialogIntent,
    bookDialogMode,
    activeBook,
    exportBookTarget,
    manuscriptExportPending,
    openBookDialog,
    closeBookDialog,
    openBookExportDialog,
    closeBookExportDialog,
    createBook,
    renameBook,
    updateBookBindings,
    removeBook,
    deleteBook,
    exportBookManuscript,
    drain,
    dispose
  };
}
