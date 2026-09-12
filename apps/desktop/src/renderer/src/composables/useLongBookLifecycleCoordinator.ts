import type {
  CreateLongBookInput,
  LongImportContinuationInput,
  LongLegacySyncModule,
  LongManuscriptExportSection,
  LongOpenBookResult
} from "@deepwrite/contracts";
import type { Ref } from "vue";

import type { LongBookResourceNodeActionPayload } from "../types/workspace";
import {
  createLongContinuitySelection,
  longBookResourceId,
  replaceLongBookSummary,
  type LongStructureMutationCompletion
} from "../types/longWorkspace";
import { longNavigationNodeId } from "../utils/longWorkspaceResourceTree";

import type {
  MaybePromise,
  PendingLane,
  LongBindingsDialogMode,
  LongBookLifecycleCoordinatorOptions,
  LongBookBindingsUpdate
} from "./longBookLifecycleTypes";
export type * from "./longBookLifecycleTypes";
import { useLongConflictResolution } from "./useLongConflictResolution";
import { disposeLongBookRemovalRuntime } from "./book-removal-runtime";

interface PendingLease {
  readonly lane: PendingLane;
  readonly requestId: number;
  readonly pending: Ref<boolean>;
}

interface BindingsTarget {
  readonly requestId: number;
  readonly bookId: string;
  readonly mode: LongBindingsDialogMode;
}

/**
 * Owns long-book creation/import and whole-book lifecycle mutations.
 * Generic resource dispatch, navigation and structure transactions deliberately
 * remain outside this boundary.
 */
export function useLongBookLifecycleCoordinator(
  options: LongBookLifecycleCoordinatorOptions
) {
  const {
    catalog,
    conversations,
    manuscript,
    notifications: uiMessage,
    resources,
    scheduler,
    session,
    state,
    workflow
  } = options;

  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let pendingRequestClock = 0;
  let dialogRequestEpoch = 0;
  let bindingsTarget: BindingsTarget | null = null;
  const ownedPendingLeases = new Map<PendingLane, PendingLease>();
  const dialogTargetRequests = new WeakMap<object, number>();
  const inFlightOperations = new Set<Promise<unknown>>();

  function pendingRef(lane: PendingLane): Ref<boolean> {
    if (lane === "mutation") return state.mutationPending;
    if (lane === "book-action") return state.bookActionPending;
    return state.manuscriptExportPending;
  }

  function acquirePendingLease(lane: PendingLane): PendingLease | null {
    if (disposed || ownedPendingLeases.has(lane)) return null;
    const pending = pendingRef(lane);
    // A true value without a locally owned lease belongs to another boundary.
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

  function leaseIsCurrent(lease: PendingLease): boolean {
    return !disposed && ownedPendingLeases.get(lease.lane) === lease;
  }

  function releasePendingLease(lease: PendingLease): void {
    if (ownedPendingLeases.get(lease.lane) !== lease) return;
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

  function issueTrackedBackground(task: () => MaybePromise<unknown>): void {
    if (disposed) return;
    const operation = Promise.resolve()
      .then(task)
      .catch(() => undefined);
    inFlightOperations.add(operation);
    void operation.finally(() => inFlightOperations.delete(operation));
  }

  function beginDialogRequest(): number | null {
    if (disposed) return null;
    return ++dialogRequestEpoch;
  }

  function markDialogTarget<Value extends object>(
    target: Value,
    requestId: number
  ): Value {
    dialogTargetRequests.set(target, requestId);
    return target;
  }

  function requestForTarget(target: object): number {
    return dialogTargetRequests.get(target) ?? dialogRequestEpoch;
  }

  function dialogRequestIsCurrent(requestId: number): boolean {
    return !disposed && dialogRequestEpoch === requestId;
  }

  function targetIsCurrent<Value extends object>(
    targetRef: Ref<Value | null>,
    target: Value,
    requestId = requestForTarget(target)
  ): boolean {
    return dialogRequestIsCurrent(requestId) && targetRef.value === target;
  }

  function cancelDialogRequests(): void {
    dialogRequestEpoch += 1;
  }

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function clearRefreshStatusFor(bookId: string): void {
    if (state.refreshStatus.value?.bookId === bookId) {
      state.refreshStatus.value = null;
    }
  }

  function publishOpenedBookResult(opened: LongOpenBookResult): void {
    session.invalidateWorkspaceRefresh(opened.book.id);
    clearRefreshStatusFor(opened.book.id);
    state.longBooks.value = replaceLongBookSummary(
      state.longBooks.value,
      opened.summary
    );
    if (state.activeBookId.value !== opened.book.id) return;
    state.workspaceIndex.value = opened.book.workspaceIndex;
  }

  function activateLongBookWorkspace(opened: LongOpenBookResult): void {
    if (disposed) return;
    issueTrackedBackground(() => session.loadAgentSettings());
    session.activateOpenedBook(opened);
    state.selectedResourceId.value = longBookResourceId(opened.book.id);
    resources.showConversation();
    resources.revealEditor();
  }

  function createLongBook(input: CreateLongBookInput): Promise<void> {
    const api = options.api();
    if (!api) {
      uiMessage.warning("浏览器预览不能保存长篇作品，请使用桌面客户端创建。");
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorBeforeLeaving())) return;
        if (!leaseIsCurrent(lease)) return;
        const opened = await api.create(input);
        if (!opened || !leaseIsCurrent(lease)) return;
        state.createBookDialogOpen.value = false;
        activateLongBookWorkspace(opened);
        await catalog.loadBookList({ force: true });
        if (!leaseIsCurrent(lease)) return;
        await catalog.refreshWorkspaceDirectory();
        if (!leaseIsCurrent(lease)) return;
        uiMessage.success(`已创建长篇“${opened.book.title}”`);
      } catch (error: unknown) {
        if (leaseIsCurrent(lease)) {
          uiMessage.error(errorMessage(error, "创建长篇作品失败。"));
        }
      }
    });
  }

  function openExistingLongBook(): Promise<void> {
    const api = options.api();
    if (!api) {
      uiMessage.warning("浏览器预览不能打开本地长篇，请使用桌面客户端。");
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorBeforeLeaving())) return;
        if (!leaseIsCurrent(lease)) return;
        const opened = await api.openExisting();
        if (!opened || !leaseIsCurrent(lease)) return;
        activateLongBookWorkspace(opened);
        await catalog.loadBookList({ force: true });
        if (leaseIsCurrent(lease)) {
          uiMessage.success(`已打开长篇“${opened.book.title}”`);
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease)) {
          uiMessage.error(errorMessage(error, "打开已有长篇失败。"));
        }
      }
    });
  }

  function chooseContinuationImportSource(): Promise<void> {
    const api = options.api();
    if (!api) {
      uiMessage.warning("浏览器预览不能导入本地 TXT 章节，请使用桌面客户端。");
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    const requestId = lease ? beginDialogRequest() : null;
    if (!lease || requestId === null) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorBeforeLeaving())) return;
        if (!leaseIsCurrent(lease) || !dialogRequestIsCurrent(requestId))
          return;
        const preview = await api.chooseContinuationImportSource();
        if (
          !preview ||
          !leaseIsCurrent(lease) ||
          !dialogRequestIsCurrent(requestId)
        ) {
          return;
        }
        state.continuationImportPreview.value = markDialogTarget(
          preview,
          requestId
        );
        if (preview.warnings.length > 0) {
          uiMessage.info("已完成章节扫描，请在预览中核对排序提示。");
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "扫描续写章节文件夹失败。"));
        }
      }
    });
  }

  function importPortableLongBook(): Promise<void> {
    const api = options.api();
    if (!api) {
      uiMessage.warning("浏览器预览不能导入可移植长篇，请使用桌面客户端。");
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorBeforeLeaving())) return;
        if (!leaseIsCurrent(lease)) return;
        const imported = await api.importPortable();
        if (!imported || !leaseIsCurrent(lease)) return;
        activateLongBookWorkspace(imported);
        await catalog.loadBookList({ force: true });
        if (leaseIsCurrent(lease)) {
          uiMessage.success(`已导入可移植长篇“${imported.book.title}”`);
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease)) {
          uiMessage.error(errorMessage(error, "导入可移植长篇失败。"));
        }
      }
    });
  }

  function confirmContinuationImport(
    input: LongImportContinuationInput
  ): Promise<void> {
    const api = options.api();
    const preview = state.continuationImportPreview.value;
    if (!api || !preview || input.previewId !== preview.previewId) {
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    if (!lease) return Promise.resolve();
    const requestId = requestForTarget(preview);
    return runWithLease(lease, async () => {
      try {
        const imported = await api.importContinuation(input);
        if (!imported || !leaseIsCurrent(lease)) return;
        const targetCurrent = targetIsCurrent(
          state.continuationImportPreview,
          preview,
          requestId
        );
        if (targetCurrent) {
          state.continuationImportPreview.value = null;
          activateLongBookWorkspace(imported);
        }
        await catalog.loadBookList({ force: true });
        if (!leaseIsCurrent(lease)) return;
        await catalog.refreshWorkspaceDirectory();
        if (
          !leaseIsCurrent(lease) ||
          !targetCurrent ||
          !dialogRequestIsCurrent(requestId)
        ) {
          return;
        }
        const selection = createLongContinuitySelection(
          imported.summary,
          imported.book.workspaceIndex,
          imported.pendingChapterCardId
        );
        if (selection) {
          state.selectedResourceId.value = longNavigationNodeId(
            imported.book.id,
            selection.key
          );
          resources.revealEditor();
          await session.selectWorkspaceFile(selection);
        }
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.success(
            `已导入长篇“${imported.book.title}”：${imported.importedChapterCount} 章，最后一章等待连续性核验`
          );
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "续写导入失败。"));
        }
      }
    });
  }

  function closeContinuationImportDialog(): void {
    if (disposed || state.mutationPending.value) return;
    cancelDialogRequests();
    state.continuationImportPreview.value = null;
  }

  function duplicateLongBook(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    const api = options.api();
    if (!api) return Promise.resolve();
    const bookId = payload.node.longBookId;
    const lease = acquirePendingLease("book-action");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (
          state.activeBookId.value === bookId &&
          !(await session.saveActiveEditorChanges())
        ) {
          return;
        }
        if (!leaseIsCurrent(lease)) return;
        const duplicated = await api.duplicateBook({ bookId });
        if (!leaseIsCurrent(lease)) return;
        await catalog.loadBookList({ force: true });
        if (!leaseIsCurrent(lease)) return;
        await scheduler.settleUi();
        if (!leaseIsCurrent(lease)) return;
        await resources.selectBook(duplicated.book.id);
        if (leaseIsCurrent(lease)) {
          uiMessage.success(
            `已复制“${payload.node.label}”为“${duplicated.summary.title}”`
          );
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease)) {
          uiMessage.error(errorMessage(error, "复制长篇失败。"));
        }
      }
    });
  }

  function chooseLegacySyncSource(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    const api = options.api();
    if (!api) return Promise.resolve();
    const bookId = payload.node.longBookId;
    const lease = acquirePendingLease("mutation");
    const requestId = lease ? beginDialogRequest() : null;
    if (!lease || requestId === null) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        const saved =
          state.activeBookId.value === bookId
            ? await session.saveActiveEditorChanges()
            : await session.saveActiveEditorBeforeLeaving(bookId);
        if (
          !saved ||
          !leaseIsCurrent(lease) ||
          !dialogRequestIsCurrent(requestId)
        ) {
          return;
        }
        if (
          state.activeBookId.value !== bookId ||
          !state.workspaceIndex.value
        ) {
          await session.openBook(bookId);
        }
        if (
          !leaseIsCurrent(lease) ||
          !dialogRequestIsCurrent(requestId) ||
          state.activeBookId.value !== bookId ||
          !state.workspaceIndex.value
        ) {
          return;
        }
        const preview = await api.chooseLegacySyncSource();
        if (
          !preview ||
          !leaseIsCurrent(lease) ||
          !dialogRequestIsCurrent(requestId)
        ) {
          return;
        }
        state.legacySyncResult.value = null;
        state.legacySyncPreview.value = markDialogTarget(preview, requestId);
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "读取旧版本压缩包失败。"));
        }
      }
    });
  }

  function closeLegacySyncDialog(): void {
    if (disposed || state.mutationPending.value) return;
    cancelDialogRequests();
    state.legacySyncPreview.value = null;
    state.legacySyncResult.value = null;
  }

  function confirmLegacySync(modules: LongLegacySyncModule[]): Promise<void> {
    const api = options.api();
    const preview = state.legacySyncPreview.value;
    const bookId = state.activeBookId.value;
    if (!api || !preview || !bookId || modules.length === 0) {
      return Promise.resolve();
    }
    const lease = acquirePendingLease("mutation");
    if (!lease) return Promise.resolve();
    const requestId = requestForTarget(preview);
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorChanges())) return;
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.legacySyncPreview, preview, requestId)
        ) {
          return;
        }
        if (!(await session.refreshActiveWorkspace(bookId))) {
          if (leaseIsCurrent(lease)) {
            uiMessage.error("无法读取长篇工作区，本次同步未执行。");
          }
          return;
        }
        const summary = state.activeBookSummary.value;
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.legacySyncPreview, preview, requestId) ||
          summary?.id !== bookId
        ) {
          return;
        }
        const result = await api.applyLegacySync({
          bookId,
          previewId: preview.previewId,
          modules: [...modules]
        });
        if (!leaseIsCurrent(lease)) return;
        const targetCurrent = targetIsCurrent(
          state.legacySyncPreview,
          preview,
          requestId
        );
        if (targetCurrent) state.legacySyncResult.value = result;
        await catalog.loadBookList({ force: true });
        if (
          !leaseIsCurrent(lease) ||
          !targetCurrent ||
          !dialogRequestIsCurrent(requestId)
        ) {
          return;
        }
        await session.refreshActiveWorkspace(bookId);
        if (
          leaseIsCurrent(lease) &&
          targetCurrent &&
          dialogRequestIsCurrent(requestId)
        ) {
          uiMessage.success(`已将旧版本“${preview.sourceTitle}”同步到当前长篇`);
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "同步旧版本失败。"));
        }
      }
    });
  }

  function openExportDialog(bookId: string, title: string): void {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    state.exportTarget.value = markDialogTarget({ bookId, title }, requestId);
  }

  function closeLongExportDialog(): void {
    if (disposed) return;
    const target = state.exportTarget.value;
    const ownedLease = ownedPendingLeases.get("manuscript-export");
    if (
      target &&
      ownedLease &&
      requestForTarget(target) === ownedLease.requestId
    ) {
      return;
    }
    if (state.manuscriptExportPending.value && !ownedLease) return;
    cancelDialogRequests();
    state.exportTarget.value = null;
  }

  function exportLongBookManuscript(
    sections: LongManuscriptExportSection[]
  ): Promise<void> {
    const api = options.api();
    const target = state.exportTarget.value;
    if (!api || !target || !manuscript.available()) return Promise.resolve();
    const lease = acquirePendingLease("manuscript-export");
    if (!lease) return Promise.resolve();
    // Associate this lease with the target without reusing the shared pending ref
    // as an ownership token.
    const requestId = requestForTarget(target);
    const exportLease: PendingLease = {
      ...lease,
      requestId
    };
    ownedPendingLeases.set("manuscript-export", exportLease);
    return runWithLease(exportLease, async () => {
      try {
        if (
          state.activeBookId.value === target.bookId &&
          !(await session.saveActiveEditorChanges())
        ) {
          return;
        }
        if (
          !leaseIsCurrent(exportLease) ||
          !targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const snapshot = await api.getWorkspaceIndex({ bookId: target.bookId });
        if (
          !leaseIsCurrent(exportLease) ||
          !targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const exportInput = await manuscript.createInput({
          api,
          bookId: target.bookId,
          title: target.title,
          workspace: snapshot.workspaceIndex,
          sections
        });
        if (
          !leaseIsCurrent(exportLease) ||
          !targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const result = await manuscript.exportLong(exportInput);
        if (!leaseIsCurrent(exportLease) || result.status !== "saved") return;
        if (targetIsCurrent(state.exportTarget, target, requestId)) {
          state.exportTarget.value = null;
          uiMessage.success(
            `已导出“${target.title}”，共生成 ${result.fileCount} 个 TXT 文件`
          );
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(exportLease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "导出长篇失败。"));
        }
      }
    });
  }

  function openRenameDialog(bookId: string, title: string): void {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    state.bookRenameTarget.value = markDialogTarget(
      { bookId, title },
      requestId
    );
  }

  function closeLongBookRenameDialog(): void {
    if (disposed) return;
    cancelDialogRequests();
    state.bookRenameTarget.value = null;
  }

  function renameLongBook(title: string): Promise<void> {
    const api = options.api();
    const target = state.bookRenameTarget.value;
    if (!api || !target) return Promise.resolve();
    const lease = acquirePendingLease("book-action");
    if (!lease) return Promise.resolve();
    const requestId = requestForTarget(target);
    return runWithLease(lease, async () => {
      try {
        if (state.activeBookId.value === target.bookId) {
          if (!(await session.saveActiveEditorChanges())) return;
          if (
            !leaseIsCurrent(lease) ||
            !targetIsCurrent(state.bookRenameTarget, target, requestId)
          ) {
            return;
          }
          if (!(await session.refreshActiveWorkspace(target.bookId))) {
            if (leaseIsCurrent(lease)) {
              uiMessage.error("无法读取长篇工作区，本次改名未执行。");
            }
            return;
          }
        } else {
          await catalog.loadBookList({ force: true });
        }
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.bookRenameTarget, target, requestId)
        ) {
          return;
        }
        const summary = state.longBooks.value.find(
          ({ id }) => id === target.bookId
        );
        if (!summary) {
          state.bookRenameTarget.value = null;
          uiMessage.warning("未找到要修改名称的长篇。");
          return;
        }
        const updated = await api.rename({
          bookId: target.bookId,
          title
        });
        if (!leaseIsCurrent(lease)) return;
        publishOpenedBookResult(updated);
        const targetCurrent = targetIsCurrent(
          state.bookRenameTarget,
          target,
          requestId
        );
        if (targetCurrent) state.bookRenameTarget.value = null;
        await catalog.loadBookList({ force: true });
        if (
          leaseIsCurrent(lease) &&
          targetCurrent &&
          dialogRequestIsCurrent(requestId)
        ) {
          uiMessage.success(
            `已将“${target.title}”修改为“${updated.summary.title}”`
          );
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "修改长篇名称失败。"));
        }
      }
    });
  }

  function openBindingsDialog(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    const bookId = payload.node.longBookId;
    const mode: LongBindingsDialogMode =
      payload.action === "bind-skill" ? "skill" : "material";
    const requestId = beginDialogRequest();
    if (requestId === null) return Promise.resolve();
    return runTracked(async () => {
      const saved =
        state.activeBookId.value === bookId
          ? await session.saveActiveEditorChanges()
          : await session.saveActiveEditorBeforeLeaving(bookId);
      if (!saved || !dialogRequestIsCurrent(requestId)) return;
      state.selectedResourceId.value = payload.node.id;
      resources.showConversation();
      if (state.activeBookId.value !== bookId) {
        await session.openBook(bookId);
      }
      if (
        !dialogRequestIsCurrent(requestId) ||
        state.activeBookId.value !== bookId ||
        state.activeBookSummary.value?.id !== bookId
      ) {
        return;
      }
      bindingsTarget = { requestId, bookId, mode };
      state.bindingsDialogMode.value = mode;
    });
  }

  function closeLongBookBindingsDialog(): void {
    if (disposed) return;
    cancelDialogRequests();
    bindingsTarget = null;
    state.bindingsDialogMode.value = null;
  }

  function updateLongBookBindings(
    payload: LongBookBindingsUpdate
  ): Promise<void> {
    const api = options.api();
    const target = bindingsTarget;
    if (
      !api ||
      !target ||
      state.bindingsDialogMode.value !== target.mode ||
      state.activeBookId.value !== target.bookId
    ) {
      return Promise.resolve();
    }
    const bindingLabel = target.mode === "skill" ? "技能库绑定" : "素材库绑定";
    const lease = acquirePendingLease("book-action");
    if (!lease) return Promise.resolve();
    return runWithLease(lease, async () => {
      try {
        if (!(await session.saveActiveEditorChanges())) return;
        if (
          !leaseIsCurrent(lease) ||
          bindingsTarget !== target ||
          !dialogRequestIsCurrent(target.requestId)
        ) {
          return;
        }
        if (!(await session.refreshActiveWorkspace(target.bookId))) {
          if (leaseIsCurrent(lease)) {
            uiMessage.error("无法读取长篇工作区，本次绑定修改未执行。");
          }
          return;
        }
        const summary = state.activeBookSummary.value;
        if (
          !leaseIsCurrent(lease) ||
          bindingsTarget !== target ||
          !dialogRequestIsCurrent(target.requestId) ||
          summary?.id !== target.bookId
        ) {
          return;
        }
        const updated = await api.updateBindings({
          bookId: target.bookId,
          linkedMaterialIdsByKind: payload.linkedMaterialIdsByKind,
          linkedSkillIdsByKind: payload.linkedSkillIdsByKind,
          linkedResourceStageScopes: payload.linkedResourceStageScopes ??
            summary.linkedResourceStageScopes ?? {
              materials: {},
              skills: {}
            }
        });
        if (!leaseIsCurrent(lease)) return;
        publishOpenedBookResult(updated);
        const targetCurrent =
          bindingsTarget === target &&
          dialogRequestIsCurrent(target.requestId) &&
          state.bindingsDialogMode.value === target.mode;
        if (targetCurrent) {
          bindingsTarget = null;
          state.bindingsDialogMode.value = null;
        }
        await catalog.loadBookList({ force: true });
        if (leaseIsCurrent(lease) && targetCurrent) {
          uiMessage.success(
            `已更新长篇“${updated.book.title}”的${bindingLabel}`
          );
        }
      } catch (error: unknown) {
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(target.requestId)) {
          uiMessage.error(errorMessage(error, `更新长篇${bindingLabel}失败。`));
        }
      }
    });
  }

  function openStructureDialog(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    const bookId = payload.node.longBookId;
    const requestId = beginDialogRequest();
    if (requestId === null) return Promise.resolve();
    return runTracked(async () => {
      const saved =
        state.activeBookId.value === bookId
          ? await session.saveActiveEditorChanges()
          : await session.saveActiveEditorBeforeLeaving(bookId);
      if (!saved || !dialogRequestIsCurrent(requestId)) return;
      state.selectedResourceId.value = payload.node.id;
      resources.showConversation();
      if (state.activeBookId.value !== bookId || !state.workspaceIndex.value) {
        await session.openBook(bookId);
      }
      if (
        dialogRequestIsCurrent(requestId) &&
        state.activeBookId.value === bookId &&
        state.workspaceIndex.value
      ) {
        state.structureAgentsMdPending.value = true;
        state.structureAgentsMd.value = null;
        state.structureDialogOpen.value = true;
        const api = options.api();
        if (!api) {
          state.structureAgentsMdPending.value = false;
          uiMessage.warning("当前环境未连接长篇工作区。");
          return;
        }
        try {
          const result = await api.readAgentsMd({ bookId });
          if (!dialogRequestIsCurrent(requestId)) return;
          state.structureAgentsMd.value = result.content;
        } catch (error: unknown) {
          if (!dialogRequestIsCurrent(requestId)) return;
          uiMessage.warning(
            error instanceof Error
              ? `读取长篇上下文失败：${error.message}`
              : "读取长篇上下文失败，请重试。"
          );
          state.structureAgentsMd.value = "";
        } finally {
          if (dialogRequestIsCurrent(requestId)) {
            state.structureAgentsMdPending.value = false;
          }
        }
      }
    });
  }

  function openRemovalDialog(
    action: "unregister" | "delete",
    bookId: string,
    title: string
  ): void {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    state.bookRemovalTarget.value = markDialogTarget(
      { action, bookId, title },
      requestId
    );
  }

  function closeLongBookRemovalDialog(): void {
    if (disposed) return;
    cancelDialogRequests();
    state.bookRemovalTarget.value = null;
  }

  async function compensateQuarantine(bookId: string): Promise<void> {
    try {
      await workflow.reactivateBook(bookId);
    } catch (error: unknown) {
      if (!disposed) {
        uiMessage.error(errorMessage(error, "恢复长篇运行状态失败。"));
      }
    }
  }

  function confirmLongBookRemoval(): Promise<void> {
    const api = options.api();
    const target = state.bookRemovalTarget.value;
    if (!api || !target) return Promise.resolve();
    const lease = acquirePendingLease("book-action");
    if (!lease) return Promise.resolve();
    const requestId = requestForTarget(target);
    return runWithLease(lease, async () => {
      let quarantined = false;
      let durablyRemoved = false;
      try {
        if (
          state.activeBookId.value === target.bookId &&
          !(await session.saveActiveEditorBeforeLeaving())
        ) {
          return;
        }
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.bookRemovalTarget, target, requestId)
        ) {
          return;
        }
        await workflow.stopBookAgentRuns(target.bookId);
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.bookRemovalTarget, target, requestId)
        ) {
          return;
        }
        quarantined = true;
        await workflow.quarantineBook(target.bookId);
        if (
          !leaseIsCurrent(lease) ||
          !targetIsCurrent(state.bookRemovalTarget, target, requestId)
        ) {
          await compensateQuarantine(target.bookId);
          quarantined = false;
          return;
        }
        const result =
          target.action === "delete"
            ? await api.delete({ bookId: target.bookId })
            : await api.unregister({ bookId: target.bookId });
        if (!result.removed) {
          await compensateQuarantine(target.bookId);
          quarantined = false;
          if (!leaseIsCurrent(lease)) return;
          if (targetIsCurrent(state.bookRemovalTarget, target, requestId)) {
            state.bookRemovalTarget.value = null;
            uiMessage.warning("该长篇已经不在当前创作空间中。");
          }
          await catalog.loadBookList({ force: true });
          return;
        }
        durablyRemoved = true;
        quarantined = false;
        const cleanupError = await disposeLongBookRemovalRuntime({
          bookId: target.bookId,
          action: target.action,
          workflow,
          conversations
        });
        if (!leaseIsCurrent(lease)) return;
        state.longBooks.value = state.longBooks.value.filter(
          ({ id }) => id !== target.bookId
        );
        await session.clearActiveBook(target.bookId);
        if (!leaseIsCurrent(lease)) return;
        const targetCurrent = targetIsCurrent(
          state.bookRemovalTarget,
          target,
          requestId
        );
        if (targetCurrent) state.bookRemovalTarget.value = null;
        await catalog.loadBookList({ force: true });
        if (
          leaseIsCurrent(lease) &&
          targetCurrent &&
          dialogRequestIsCurrent(requestId)
        ) {
          if (cleanupError) {
            uiMessage.error(
              errorMessage(cleanupError, "长篇已移除，但本地运行状态清理失败。")
            );
          } else {
            uiMessage.success(
              target.action === "delete"
                ? `已永久删除长篇“${target.title}”`
                : `已从创作空间移除“${target.title}”，磁盘文件仍保留`
            );
          }
        }
      } catch (error: unknown) {
        if (quarantined && !durablyRemoved) {
          await compensateQuarantine(target.bookId);
        }
        if (leaseIsCurrent(lease) && dialogRequestIsCurrent(requestId)) {
          uiMessage.error(errorMessage(error, "处理长篇项目失败。"));
        }
      }
    });
  }

  const resolveConflicts = useLongConflictResolution({
    ...options,
    isDisposed: () => disposed,
    runTracked
  });

  function handleLongBookAction(
    payload: LongBookResourceNodeActionPayload
  ): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!options.api()) {
      uiMessage.warning("浏览器预览不能管理本地长篇，请使用桌面客户端。");
      return Promise.resolve();
    }
    const { longBookId: bookId } = payload.node;
    switch (payload.action) {
      case "resolve-conflicts":
        return resolveConflicts(payload.node.longBookId);
      case "duplicate":
        return duplicateLongBook(payload);
      case "sync-legacy":
        return chooseLegacySyncSource(payload);
      case "export":
        openExportDialog(bookId, payload.node.label);
        return Promise.resolve();
      case "rename":
        openRenameDialog(bookId, payload.node.label);
        return Promise.resolve();
      case "manage-structure":
        return openStructureDialog(payload);
      case "bind-skill":
      case "bind-material":
        return openBindingsDialog(payload);
      case "unregister":
      case "delete":
        openRemovalDialog(payload.action, bookId, payload.node.label);
        return Promise.resolve();
    }
  }

  async function saveLongAgentsMd(
    content: string,
    completion: LongStructureMutationCompletion
  ): Promise<void> {
    const bookId = state.activeBookId.value;
    const api = options.api();
    if (!bookId || !api) {
      const message = "当前长篇结构尚未就绪。";
      uiMessage.warning(message);
      completion.fail(message);
      return;
    }
    try {
      await api.writeAgentsMd({ bookId, content });
      state.structureAgentsMd.value = content;
      completion.succeed();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "保存长篇上下文失败，请稍后重试。";
      uiMessage.error(message);
      completion.fail(message);
    }
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
    cancelDialogRequests();
    bindingsTarget = null;
    disposePromise = (async () => {
      await drain();
      // Normally runWithLease releases these. This fallback releases only leases
      // acquired by this coordinator and therefore cannot clear foreign pending.
      for (const lease of [...ownedPendingLeases.values()]) {
        releasePendingLease(lease);
      }
    })();
    await disposePromise;
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
    closeLongBookBindingsDialog,
    updateLongBookBindings,
    closeLongBookRemovalDialog,
    confirmLongBookRemoval,
    saveLongAgentsMd,
    drain,
    dispose
  };
}

export type LongBookLifecycleCoordinator = ReturnType<
  typeof useLongBookLifecycleCoordinator
>;
