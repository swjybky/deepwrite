import type {
  Book,
  CreateScriptBookInput,
  CreateShortBookInput,
  DeepWriteApi,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  ShortManuscriptExportFormat
} from "@deepwrite/contracts";
import type { Ref, ShallowRef } from "vue";
import type {
  BookResourceDialogMode,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";
import type { ShortManuscriptExportTarget } from "../utils/shortManuscriptExport";
import { executeShortManuscriptExport } from "./short-manuscript-export-transaction";
import { disposeShortBookRemovalRuntime } from "./book-removal-runtime";

type MaybePromise<Value> = Value | Promise<Value>;
type PendingLane = "catalog" | "manuscript-export";
type DraftFileKind = "body" | "character-state";

export type CreateShortOrScriptBookInput =
  | ({ workspaceType: "short" } & CreateShortBookInput)
  | ({ workspaceType: "script" } & CreateScriptBookInput);

export type ShortBookBindingsUpdate =
  | {
      bookId: string;
      domain: "skill";
      linksByKind: LinkedSkillIdsByKind;
    }
  | {
      bookId: string;
      domain: "material";
      linksByKind: LinkedMaterialIdsByKind;
    };

/**
 * Immutable, request-scoped book identity captured when a dialog action opens.
 * `node` deliberately contains only the root metadata needed by dialogs and
 * commands; `resourceIds` retains the complete tree identity for cleanup.
 */
export interface ShortBookLifecycleTarget {
  readonly requestId: number;
  readonly bookId: string;
  readonly label: string;
  readonly workspaceType: "short" | "script";
  readonly projectRevision: number | undefined;
  readonly unavailable: boolean;
  readonly node: Readonly<ResourceTreeNode>;
  readonly resourceIds: readonly string[];
}

export interface ShortBookLifecycleNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface ShortBookLifecycleState {
  dialogIntent: Readonly<Ref<number>>;
  bookDialogMode: Ref<BookResourceDialogMode | null>;
  activeBook: ShallowRef<ShortBookLifecycleTarget | null>;
  exportBookTarget: ShallowRef<ShortBookLifecycleTarget | null>;
  manuscriptExportPending: Ref<boolean>;
  catalogMutationPending: Ref<boolean>;
  createBookDialogOpen: Ref<boolean>;
  documents: ShallowRef<WorkspaceDocument[]>;
  drafts: ShallowRef<Record<string, EditorDraftState>>;
  selectedResourceId: Ref<string>;
  activeCreationResourceId: Ref<string>;
  selectedExpertSectionIds: Ref<Record<string, string>>;
  selectedDraftFileKinds: Ref<Record<string, DraftFileKind>>;
}

export interface ShortBookLifecycleCatalogPort {
  api(): DeepWriteApi["catalog"] | undefined;
  book(bookId: string): Book | undefined;
  refresh(): Promise<boolean>;
  refreshWorkspaceDirectory(): Promise<void>;
  isConflict(error: unknown): boolean;
}

export interface ShortBookLifecyclePreparationPort {
  prepareBookMutation(bookId: string): Promise<boolean>;
}

export interface ShortBookLifecycleStructurePort {
  duplicateBook(book: ResourceTreeNode): Promise<void>;
  openStructure(bookId: string): Promise<boolean>;
}

export interface ShortBookLifecycleConversationPort {
  stopBookRuns(bookId: string): Promise<void>;
  disposeBook(
    bookId: string,
    options: { clearPersistence: boolean }
  ): MaybePromise<void>;
  removeRunPreferences(scope: string): MaybePromise<void>;
}

export interface ShortBookLifecycleResourcePort {
  selectPreferredBook(bookId: string): Promise<boolean>;
  settleUi(): Promise<void>;
  fallbackCreationResourceId(excludedBookId: string): string;
}

export interface ShortBookLifecycleLegacyPort {
  hasBook(target: ShortBookLifecycleTarget): boolean;
  rename(target: ShortBookLifecycleTarget, label: string): MaybePromise<void>;
  updateBindings(
    target: ShortBookLifecycleTarget,
    payload: ShortBookBindingsUpdate
  ): MaybePromise<void>;
  remove(target: ShortBookLifecycleTarget): MaybePromise<void>;
}

export interface ShortBookLifecycleManuscriptPort {
  api(): DeepWriteApi["manuscript"] | undefined;
  ensureDocumentsLoaded(
    documents: readonly WorkspaceDocument[]
  ): Promise<boolean>;
}

export interface ShortBookLifecycleClipboardPort {
  writeText(text: string): Promise<void>;
}

export interface ShortBookLifecycleCoordinatorOptions {
  state: ShortBookLifecycleState;
  catalog: ShortBookLifecycleCatalogPort;
  preparation: ShortBookLifecyclePreparationPort;
  structure: ShortBookLifecycleStructurePort;
  conversations: ShortBookLifecycleConversationPort;
  resources: ShortBookLifecycleResourcePort;
  legacy: ShortBookLifecycleLegacyPort;
  manuscript: ShortBookLifecycleManuscriptPort;
  clipboard: ShortBookLifecycleClipboardPort;
  notifications: ShortBookLifecycleNotifications;
}

interface PendingLease {
  readonly lane: PendingLane;
  readonly requestId: number;
  readonly pending: Ref<boolean>;
}

interface RemovalAnchors {
  readonly selectedResourceId: string;
  readonly selectedBelongedToBook: boolean;
  readonly activeCreationResourceId: string;
  readonly activeCreationBelongedToBook: boolean;
}

const MANUSCRIPT_EXPORT_FORMAT_LABELS: Record<
  ShortManuscriptExportFormat,
  string
> = {
  docx: "DOCX",
  txt: "TXT",
  epub: "EPUB"
};

/** Owns whole-book short/script transactions and their durable cleanup. */
export function useShortBookLifecycleCoordinator(
  options: ShortBookLifecycleCoordinatorOptions
) {
  const {
    catalog,
    clipboard,
    conversations,
    legacy,
    manuscript,
    notifications,
    preparation,
    resources,
    state,
    structure
  } = options;

  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let pendingRequestClock = 0;
  const ownedPendingLeases = new Map<PendingLane, PendingLease>();
  const inFlightOperations = new Set<Promise<unknown>>();
  const durablyRemovedBookIds = new Set<string>();

  function pendingRef(lane: PendingLane): Ref<boolean> {
    return lane === "catalog"
      ? state.catalogMutationPending
      : state.manuscriptExportPending;
  }

  function acquirePendingLease(lane: PendingLane): PendingLease | null {
    if (disposed || ownedPendingLeases.has(lane)) return null;
    const pending = pendingRef(lane);
    // A true ref without our lease belongs to a foreign catalog boundary.
    if (pending.value) return null;
    const lease: PendingLease = {
      lane,
      requestId: ++pendingRequestClock,
      pending
    };
    ownedPendingLeases.set(lane, lease);
    pending.value = true;
    return lease;
  }

  function leaseIsOwned(lease: PendingLease): boolean {
    return ownedPendingLeases.get(lease.lane) === lease;
  }

  function leaseCanPublish(lease: PendingLease): boolean {
    return !disposed && leaseIsOwned(lease);
  }

  function releasePendingLease(lease: PendingLease): void {
    if (!leaseIsOwned(lease)) return;
    ownedPendingLeases.delete(lease.lane);
    lease.pending.value = false;
  }

  async function runTracked<Value>(task: () => Promise<Value>): Promise<Value> {
    const operation = task();
    inFlightOperations.add(operation);
    try {
      return await operation;
    } finally {
      inFlightOperations.delete(operation);
    }
  }

  async function runWithLease(
    lease: PendingLease,
    task: () => Promise<void>
  ): Promise<void> {
    await runTracked(async () => {
      try {
        await task();
      } finally {
        releasePendingLease(lease);
      }
    });
  }

  function dialogIntentIsCurrent(requestId: number): boolean {
    return !disposed && state.dialogIntent.value === requestId;
  }

  function activeTargetIsCurrent(
    target: ShortBookLifecycleTarget,
    expectedModes?: readonly BookResourceDialogMode[]
  ): boolean {
    return (
      dialogIntentIsCurrent(target.requestId) &&
      state.activeBook.value === target &&
      (!expectedModes ||
        Boolean(
          state.bookDialogMode.value &&
          expectedModes.includes(state.bookDialogMode.value)
        ))
    );
  }

  function exportTargetIsCurrent(target: ShortBookLifecycleTarget): boolean {
    return (
      dialogIntentIsCurrent(target.requestId) &&
      state.exportBookTarget.value === target
    );
  }

  function closeActiveTarget(target: ShortBookLifecycleTarget): void {
    if (!activeTargetIsCurrent(target)) return;
    state.bookDialogMode.value = null;
    state.activeBook.value = null;
  }

  function closeExportTarget(target: ShortBookLifecycleTarget): void {
    if (!exportTargetIsCurrent(target)) return;
    state.exportBookTarget.value = null;
  }

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function workspaceTypeLabel(target: ShortBookLifecycleTarget): string {
    return target.workspaceType === "script" ? "剧本" : "书籍";
  }

  function targetResourceIds(target: ShortBookLifecycleTarget): Set<string> {
    const ids = new Set(target.resourceIds);
    for (const document of state.documents.value) {
      if (document.workspaceId !== target.bookId) continue;
      ids.add(document.id);
      if (document.draftDirectoryId) ids.add(document.draftDirectoryId);
      if (document.stageId === "draft" && !document.expertSectionId) {
        ids.add(document.id);
      }
    }
    return ids;
  }

  function resourceBelongsToTarget(
    resourceId: string,
    target: ShortBookLifecycleTarget,
    scopedResourceIds: ReadonlySet<string>
  ): boolean {
    if (!resourceId) return false;
    if (scopedResourceIds.has(resourceId)) return true;
    return state.documents.value.some(
      (document) =>
        document.workspaceId === target.bookId && document.id === resourceId
    );
  }

  function removalAnchors(
    target: ShortBookLifecycleTarget,
    scopedResourceIds: ReadonlySet<string>
  ): RemovalAnchors {
    const selectedResourceId = state.selectedResourceId.value;
    const activeCreationResourceId = state.activeCreationResourceId.value;
    return {
      selectedResourceId,
      selectedBelongedToBook: resourceBelongsToTarget(
        selectedResourceId,
        target,
        scopedResourceIds
      ),
      activeCreationResourceId,
      activeCreationBelongedToBook: resourceBelongsToTarget(
        activeCreationResourceId,
        target,
        scopedResourceIds
      )
    };
  }

  function filterRecord<Value>(
    record: Readonly<Record<string, Value>>,
    removedIds: ReadonlySet<string>
  ): Record<string, Value> {
    return Object.fromEntries(
      Object.entries(record).filter(([id]) => !removedIds.has(id))
    );
  }

  function clearRemovedBookEditorState(
    scopedResourceIds: ReadonlySet<string>
  ): void {
    state.drafts.value = filterRecord(state.drafts.value, scopedResourceIds);
    state.selectedExpertSectionIds.value = filterRecord(
      state.selectedExpertSectionIds.value,
      scopedResourceIds
    );
    state.selectedDraftFileKinds.value = filterRecord(
      state.selectedDraftFileKinds.value,
      scopedResourceIds
    );
  }

  function compensateRemovedBookSelection(
    target: ShortBookLifecycleTarget,
    anchors: RemovalAnchors
  ): void {
    const fallback = resources.fallbackCreationResourceId(target.bookId);
    if (
      anchors.selectedBelongedToBook &&
      state.selectedResourceId.value === anchors.selectedResourceId
    ) {
      state.selectedResourceId.value = fallback;
    }
    if (
      anchors.activeCreationBelongedToBook &&
      state.activeCreationResourceId.value === anchors.activeCreationResourceId
    ) {
      state.activeCreationResourceId.value = fallback;
    }
  }

  function requireVersionedCatalogTarget(
    target: ShortBookLifecycleTarget,
    operationLabel: string
  ): Book | null {
    const book = catalog.book(target.bookId);
    if (!book) return null;
    if (
      target.projectRevision === undefined ||
      book.projectRevision === undefined
    ) {
      notifications.error(
        `当前${workspaceTypeLabel(target)}缺少项目版本，无法安全${operationLabel}。`
      );
      return null;
    }
    if (book.projectRevision !== target.projectRevision) {
      notifications.warning(
        `${workspaceTypeLabel(target)}配置已在外部更新，请重新打开对话框后再${operationLabel}。`
      );
      closeActiveTarget(target);
      return null;
    }
    return book;
  }

  async function prepareTargetMutation(
    target: ShortBookLifecycleTarget,
    lease: PendingLease,
    expectedModes: readonly BookResourceDialogMode[]
  ): Promise<boolean> {
    const prepared = await preparation.prepareBookMutation(target.bookId);
    return (
      prepared &&
      leaseCanPublish(lease) &&
      activeTargetIsCurrent(target, expectedModes)
    );
  }

  async function refreshAfterDurableMutation(): Promise<boolean> {
    try {
      return await catalog.refresh();
    } catch {
      return false;
    }
  }

  function duplicateBook(target: ShortBookLifecycleTarget): Promise<void> {
    if (
      disposed ||
      !dialogIntentIsCurrent(target.requestId) ||
      target.unavailable
    ) {
      return Promise.resolve();
    }
    // The structure coordinator owns the catalog lease and performs the shared
    // prepareBookMutation preflight. Do not acquire the same shared flag here.
    return runTracked(async () => {
      if (!dialogIntentIsCurrent(target.requestId)) return;
      await structure.duplicateBook(target.node as ResourceTreeNode);
    });
  }

  function manageStructure(target: ShortBookLifecycleTarget): Promise<void> {
    if (
      disposed ||
      !dialogIntentIsCurrent(target.requestId) ||
      target.unavailable
    ) {
      return Promise.resolve();
    }
    return runTracked(async () => {
      const opened = await structure.openStructure(target.bookId);
      if (!opened || !dialogIntentIsCurrent(target.requestId)) return;
      if (state.activeBook.value === target) {
        state.activeBook.value = null;
        state.bookDialogMode.value = null;
      }
    });
  }

  function createBook(input: CreateShortOrScriptBookInput): Promise<void> {
    const api = catalog.api();
    if (!api) {
      notifications.warning("浏览器预览不能保存作品，请使用桌面客户端创建。");
      return Promise.resolve();
    }
    const lease = acquirePendingLease("catalog");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      let created: Book | null = null;
      try {
        created =
          input.workspaceType === "script"
            ? await api.createScriptBook({
                title: input.title,
                genre: input.genre,
                linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
                linkedSkillIdsByKind: input.linkedSkillIdsByKind
              })
            : await api.createShortBook({
                title: input.title,
                genre: input.genre,
                defaultPlotStageIds: input.defaultPlotStageIds,
                linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
                linkedSkillIdsByKind: input.linkedSkillIdsByKind
              });
        if (!created || !leaseIsOwned(lease)) return;

        let directoryRefreshFailed = false;
        try {
          await catalog.refreshWorkspaceDirectory();
        } catch {
          directoryRefreshFailed = true;
        }
        if (!leaseIsOwned(lease)) return;
        const refreshed = await refreshAfterDurableMutation();
        if (!leaseIsOwned(lease)) return;

        state.createBookDialogOpen.value = false;
        if (!refreshed || directoryRefreshFailed) {
          if (leaseCanPublish(lease)) {
            notifications.warning(
              `已创建${input.workspaceType === "script" ? "剧本" : "短篇"}“${created.title}”，但作品列表刷新失败；稍后将自动重试。`
            );
          }
          return;
        }
        await resources.settleUi();
        if (!leaseCanPublish(lease)) return;
        await resources.selectPreferredBook(created.id);
        if (leaseCanPublish(lease)) {
          notifications.success(
            `已创建${input.workspaceType === "script" ? "剧本" : "短篇"}“${created.title}”，素材库和技能库绑定已保存`
          );
        }
      } catch (error: unknown) {
        if (!leaseCanPublish(lease)) return;
        if (created) {
          state.createBookDialogOpen.value = false;
          notifications.warning(
            `已创建作品“${created.title}”，但刷新本地列表失败；稍后将自动重试。`
          );
        } else {
          notifications.error(errorMessage(error, "创建作品失败。"));
        }
      }
    });
  }

  function renameBook(payload: {
    bookId: string;
    label: string;
  }): Promise<void> {
    const target = state.activeBook.value;
    if (
      !target ||
      target.bookId !== payload.bookId ||
      !activeTargetIsCurrent(target, ["rename"]) ||
      target.unavailable
    ) {
      return Promise.resolve();
    }
    const api = catalog.api();
    const catalogBook = catalog.book(target.bookId);
    if (!catalogBook && !legacy.hasBook(target)) {
      closeActiveTarget(target);
      notifications.warning("未找到要修改的书籍。");
      return Promise.resolve();
    }
    if (catalogBook && !api) return Promise.resolve();
    if (catalogBook && !requireVersionedCatalogTarget(target, "修改名称")) {
      return Promise.resolve();
    }
    const lease = acquirePendingLease("catalog");
    if (!lease) return Promise.resolve();
    const label = payload.label.trim().slice(0, 80);
    return runWithLease(lease, async () => {
      try {
        if (!(await prepareTargetMutation(target, lease, ["rename"]))) return;
        if (!catalogBook) {
          await legacy.rename(target, label);
          if (!leaseIsOwned(lease)) return;
          if (activeTargetIsCurrent(target, ["rename"])) {
            closeActiveTarget(target);
            notifications.success(`已将“${target.label}”修改为“${label}”`);
          }
          return;
        }
        const authoritativeBook = catalog.book(target.bookId);
        if (authoritativeBook?.projectRevision === undefined) {
          if (leaseCanPublish(lease)) {
            notifications.error("当前书籍缺少项目版本，无法安全修改名称。");
          }
          return;
        }
        const updated = await api!.updateBook({
          bookId: target.bookId,
          baseProjectRevision: authoritativeBook.projectRevision,
          title: label
        });
        if (!leaseIsOwned(lease)) return;
        const refreshed = await refreshAfterDurableMutation();
        if (!leaseIsOwned(lease)) return;
        const targetCurrent = activeTargetIsCurrent(target, ["rename"]);
        if (targetCurrent) closeActiveTarget(target);
        if (!leaseCanPublish(lease) || !targetCurrent) return;
        if (!refreshed) {
          notifications.warning(
            `已将“${target.label}”修改为“${updated.title}”，但作品列表刷新失败；稍后将自动重试。`
          );
        } else {
          notifications.success(
            `已将“${target.label}”修改为“${updated.title}”`
          );
        }
      } catch (error: unknown) {
        if (
          !leaseCanPublish(lease) ||
          !activeTargetIsCurrent(target, ["rename"])
        ) {
          return;
        }
        if (catalog.isConflict(error)) {
          await refreshAfterDurableMutation();
          if (
            !leaseCanPublish(lease) ||
            !activeTargetIsCurrent(target, ["rename"])
          ) {
            return;
          }
          closeActiveTarget(target);
          notifications.warning(
            "书籍配置已在外部更新，已重新加载；请确认后再次修改"
          );
        } else {
          notifications.error(errorMessage(error, "修改书名失败。"));
        }
      }
    });
  }

  function updateBookBindings(payload: ShortBookBindingsUpdate): Promise<void> {
    const target = state.activeBook.value;
    const expectedMode =
      payload.domain === "skill" ? "bind-skill" : "bind-material";
    if (
      !target ||
      target.bookId !== payload.bookId ||
      !activeTargetIsCurrent(target, [expectedMode]) ||
      target.unavailable
    ) {
      return Promise.resolve();
    }
    const api = catalog.api();
    const catalogBook = catalog.book(target.bookId);
    if (!catalogBook && !legacy.hasBook(target)) {
      closeActiveTarget(target);
      notifications.warning("未找到要更新绑定的书籍。");
      return Promise.resolve();
    }
    if (catalogBook && !api) return Promise.resolve();
    if (catalogBook && !requireVersionedCatalogTarget(target, "更新绑定")) {
      return Promise.resolve();
    }
    const lease = acquirePendingLease("catalog");
    if (!lease) return Promise.resolve();
    const bindingLabel = payload.domain === "skill" ? "技能库" : "素材库";
    return runWithLease(lease, async () => {
      try {
        if (!(await prepareTargetMutation(target, lease, [expectedMode])))
          return;
        if (!catalogBook) {
          await legacy.updateBindings(target, payload);
          if (!leaseIsOwned(lease)) return;
          if (activeTargetIsCurrent(target, [expectedMode])) {
            closeActiveTarget(target);
            notifications.success(
              `已更新“${target.label}”的${bindingLabel}绑定`
            );
          }
          return;
        }
        const authoritativeBook = catalog.book(target.bookId);
        if (authoritativeBook?.projectRevision === undefined) {
          if (leaseCanPublish(lease)) {
            notifications.error("当前书籍缺少项目版本，无法安全更新绑定。");
          }
          return;
        }
        await api!.updateBook({
          bookId: target.bookId,
          baseProjectRevision: authoritativeBook.projectRevision,
          ...(payload.domain === "skill"
            ? { linkedSkillIdsByKind: payload.linksByKind }
            : { linkedMaterialIdsByKind: payload.linksByKind })
        });
        if (!leaseIsOwned(lease)) return;
        const refreshed = await refreshAfterDurableMutation();
        if (!leaseIsOwned(lease)) return;
        const targetCurrent = activeTargetIsCurrent(target, [expectedMode]);
        if (targetCurrent) closeActiveTarget(target);
        if (!leaseCanPublish(lease) || !targetCurrent) return;
        if (!refreshed) {
          notifications.warning(
            `已更新“${target.label}”的${bindingLabel}绑定，但作品列表刷新失败；稍后将自动重试。`
          );
        } else {
          notifications.success(`已更新“${target.label}”的${bindingLabel}绑定`);
        }
      } catch (error: unknown) {
        if (
          !leaseCanPublish(lease) ||
          !activeTargetIsCurrent(target, [expectedMode])
        ) {
          return;
        }
        if (catalog.isConflict(error)) {
          await refreshAfterDurableMutation();
          if (
            !leaseCanPublish(lease) ||
            !activeTargetIsCurrent(target, [expectedMode])
          ) {
            return;
          }
          closeActiveTarget(target);
          notifications.warning(
            "书籍绑定已在外部更新，已重新加载；请确认后再次保存"
          );
        } else {
          notifications.error(errorMessage(error, "更新资料库绑定失败。"));
        }
      }
    });
  }

  function removeOrDeleteBook(
    bookId: string,
    action: "remove" | "delete"
  ): Promise<void> {
    const target = state.activeBook.value;
    if (
      !target ||
      target.bookId !== bookId ||
      !activeTargetIsCurrent(target, [action])
    ) {
      return Promise.resolve();
    }
    if (durablyRemovedBookIds.has(bookId)) {
      closeActiveTarget(target);
      notifications.info("该书籍已经从当前创作空间移除。");
      return Promise.resolve();
    }
    const api = catalog.api();
    const catalogBook = catalog.book(bookId);
    const legacyTarget =
      !catalogBook && !target.unavailable && legacy.hasBook(target);
    if (action === "delete" && (target.unavailable || legacyTarget)) {
      notifications.error("该书籍没有可删除的本地项目文件夹。");
      return Promise.resolve();
    }
    if (!catalogBook && !target.unavailable && !legacyTarget) {
      closeActiveTarget(target);
      notifications.warning("未找到要处理的书籍。");
      return Promise.resolve();
    }
    if (!legacyTarget && !api) return Promise.resolve();

    const lease = acquirePendingLease("catalog");
    if (!lease) return Promise.resolve();
    const scopedResourceIds = targetResourceIds(target);
    const anchors = removalAnchors(target, scopedResourceIds);
    return runWithLease(lease, async () => {
      let durableSuccess = false;
      try {
        if (!(await prepareTargetMutation(target, lease, [action]))) return;
        await conversations.stopBookRuns(bookId);
        if (
          !leaseCanPublish(lease) ||
          !activeTargetIsCurrent(target, [action])
        ) {
          return;
        }

        if (legacyTarget) {
          await legacy.remove(target);
          if (!leaseIsOwned(lease)) return;
          durableSuccess = true;
        } else {
          let changed: boolean;
          if (action === "delete") {
            const result = await api!.deleteProject({
              domain: "book",
              projectId: bookId
            });
            changed = result.deleted;
          } else {
            const result = await api!.unregisterProject({
              domain: "book",
              projectId: bookId
            });
            changed = result.unregistered;
          }
          if (!leaseIsOwned(lease)) return;
          if (!changed) {
            if (
              leaseCanPublish(lease) &&
              activeTargetIsCurrent(target, [action])
            ) {
              closeActiveTarget(target);
              notifications.warning(
                `未找到要${action === "delete" ? "删除" : "移除"}的${workspaceTypeLabel(target)}。`
              );
            }
            await refreshAfterDurableMutation();
            return;
          }
          durableSuccess = true;
        }

        durablyRemovedBookIds.add(bookId);
        const cleanupError = await disposeShortBookRemovalRuntime({
          bookId: target.bookId,
          action,
          conversations,
          clearEditorState: () => clearRemovedBookEditorState(scopedResourceIds)
        });
        if (!leaseIsOwned(lease)) return;
        const refreshed = legacyTarget
          ? true
          : await refreshAfterDurableMutation();
        if (!leaseIsOwned(lease)) return;
        compensateRemovedBookSelection(target, anchors);

        const targetCurrent = activeTargetIsCurrent(target, [action]);
        if (targetCurrent) closeActiveTarget(target);
        if (!leaseCanPublish(lease) || !targetCurrent) return;
        if (cleanupError) {
          notifications.error(
            errorMessage(
              cleanupError,
              `${workspaceTypeLabel(target)}已移除，但本地运行状态清理失败。`
            )
          );
        } else if (!refreshed) {
          notifications.warning(
            `${action === "delete" ? "已删除" : "已移除"}“${target.label}”，但作品列表刷新失败；稍后将自动重试。`
          );
        } else {
          notifications.success(
            action === "delete"
              ? `已删除“${target.label}”及其本地文件夹`
              : `已移除“${target.label}”`
          );
        }
      } catch (error: unknown) {
        // Once the API reports success, cleanup above must be allowed to finish.
        // Errors before that point never discard local drafts or controllers.
        if (
          !durableSuccess &&
          leaseCanPublish(lease) &&
          activeTargetIsCurrent(target, [action])
        ) {
          notifications.error(
            errorMessage(
              error,
              `${action === "delete" ? "删除" : "移除"}${workspaceTypeLabel(target)}失败。`
            )
          );
        } else if (
          durableSuccess &&
          leaseCanPublish(lease) &&
          activeTargetIsCurrent(target, [action])
        ) {
          closeActiveTarget(target);
          notifications.warning(
            `${action === "delete" ? "删除" : "移除"}操作已经完成，但本地状态刷新失败；稍后将自动重试。`
          );
        }
      }
    });
  }

  function removeBook(bookId: string): Promise<void> {
    return removeOrDeleteBook(bookId, "remove");
  }

  function deleteBook(bookId: string): Promise<void> {
    return removeOrDeleteBook(bookId, "delete");
  }

  function exportBookManuscript(
    targetOutput: ShortManuscriptExportTarget
  ): Promise<void> {
    const target = state.exportBookTarget.value;
    if (!target || target.unavailable || !exportTargetIsCurrent(target)) {
      return Promise.resolve();
    }
    const lease = acquirePendingLease("manuscript-export");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        const book = catalog.book(target.bookId);
        if (!book) {
          if (leaseCanPublish(lease) && exportTargetIsCurrent(target)) {
            closeExportTarget(target);
            notifications.error("未找到要导出正文的书籍");
          }
          return;
        }
        const scopedDocuments = state.documents.value.filter(
          (document) => document.workspaceId === target.bookId
        );
        const loaded = await manuscript.ensureDocumentsLoaded(scopedDocuments);
        if (
          !loaded ||
          !leaseCanPublish(lease) ||
          !exportTargetIsCurrent(target)
        ) {
          return;
        }
        const currentBook = catalog.book(target.bookId);
        if (!currentBook) {
          closeExportTarget(target);
          notifications.error("未找到要导出正文的书籍");
          return;
        }
        const result = await executeShortManuscriptExport({
          target: targetOutput,
          book: currentBook,
          documents: state.documents.value,
          drafts: state.drafts.value,
          api: manuscript.api(),
          writeClipboardText: (text) => clipboard.writeText(text)
        });
        if (
          !leaseCanPublish(lease) ||
          !exportTargetIsCurrent(target) ||
          result.status === "cancelled"
        ) {
          return;
        }
        closeExportTarget(target);
        const scope =
          currentBook.bookType === "script" ? "全部剧集" : "导语和全部小节";
        notifications.success(
          targetOutput === "clipboard"
            ? `已复制“${currentBook.title}”的${scope}正文，可直接粘贴`
            : `已将“${currentBook.title}”的${scope}导出为 ${MANUSCRIPT_EXPORT_FORMAT_LABELS[targetOutput]}`
        );
      } catch (error: unknown) {
        if (leaseCanPublish(lease) && exportTargetIsCurrent(target)) {
          notifications.error(
            errorMessage(
              error,
              targetOutput === "clipboard" ? "复制正文失败。" : "导出正文失败。"
            )
          );
        }
      }
    });
  }

  async function drain(): Promise<void> {
    while (inFlightOperations.size > 0) {
      await Promise.allSettled([...inFlightOperations]);
    }
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return;
    disposed = true;
    disposePromise = (async () => {
      await drain();
      for (const lease of [...ownedPendingLeases.values()]) {
        releasePendingLease(lease);
      }
    })();
    await disposePromise;
  }

  return {
    createBook,
    duplicateBook,
    manageStructure,
    renameBook,
    updateBookBindings,
    removeBook,
    deleteBook,
    exportBookManuscript,
    drain,
    dispose
  };
}

export type ShortBookLifecycleCoordinator = ReturnType<
  typeof useShortBookLifecycleCoordinator
>;
