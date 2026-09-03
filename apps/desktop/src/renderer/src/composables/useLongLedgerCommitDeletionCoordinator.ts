import {
  longLedgerCommitChapterIds,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import type { LongLedgerCommitDeleteTarget } from "../stores/longWorkspaceStore";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import type { ResourceTreeNode } from "../types/workspace";

interface Notifications {
  error(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export function useLongLedgerCommitDeletionCoordinator(options: {
  api(): LongWorkspaceRendererApi | undefined;
  activeBookId: Readonly<Ref<string | null>>;
  workspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
  target: Ref<LongLedgerCommitDeleteTarget | null>;
  pending: Ref<boolean>;
  saveActiveEditorChanges(): Promise<boolean>;
  refreshActiveWorkspace(bookId: string): Promise<boolean>;
  notifications: Notifications;
}) {
  let operationId = 0;

  function request(node: ResourceTreeNode): void {
    const metadata = node.longLedgerCommit;
    const bookId = node.longBookId;
    const index = options.workspaceIndex.value;
    if (
      !metadata ||
      !bookId ||
      options.activeBookId.value !== bookId ||
      !index
    ) {
      options.notifications.warning("当前提交记录已不可用，请刷新后重试。");
      return;
    }
    const latest = index.ledger.commits.at(-1);
    if (!metadata.deletable || latest?.id !== metadata.id) {
      options.notifications.warning("请先删除最后一条提交记录。");
      return;
    }
    options.target.value = {
      bookId,
      commitId: metadata.id,
      title: node.label,
      chapterCardIds: longLedgerCommitChapterIds(latest)
    };
  }

  function close(): void {
    if (!options.pending.value) options.target.value = null;
  }

  async function confirm(): Promise<void> {
    const target = options.target.value;
    const api = options.api();
    if (!target || !api || options.pending.value) return;

    options.pending.value = true;
    const currentOperationId = ++operationId;
    try {
      if (!(await options.saveActiveEditorChanges())) return;
      if (
        currentOperationId !== operationId ||
        options.target.value !== target ||
        options.activeBookId.value !== target.bookId
      ) {
        return;
      }
      if (!(await options.refreshActiveWorkspace(target.bookId))) {
        options.notifications.error("无法读取最新连续性账本，本次删除未执行。");
        return;
      }
      const latest = options.workspaceIndex.value?.ledger.commits.at(-1);
      if (latest?.id !== target.commitId) {
        options.target.value = null;
        options.notifications.warning(
          "提交记录顺序已经变化，请重新选择最后一条记录。"
        );
        return;
      }

      const result = await api.deleteLedgerCommit({
        bookId: target.bookId,
        commitId: target.commitId
      });
      if (
        result.bookId !== target.bookId ||
        result.deletedCommitId !== target.commitId
      ) {
        throw new Error("删除提交记录返回了不一致的结果。");
      }
      options.target.value = null;
      const refreshed = await options.refreshActiveWorkspace(target.bookId);
      if (!refreshed) {
        options.notifications.warning(
          "提交记录已删除，但界面未能同步最新状态；请重新打开长篇。"
        );
        return;
      }
      options.notifications.success(
        result.chapterCardIds.length === 1
          ? "提交记录已删除，章节已回到待提交状态。"
          : "提交记录已删除，" +
              result.chapterCardIds.length +
              " 个章节已回到待提交状态。"
      );
    } catch (error: unknown) {
      options.notifications.error(
        error instanceof Error ? error.message : "删除提交记录失败。"
      );
    } finally {
      if (currentOperationId === operationId) options.pending.value = false;
    }
  }

  return { request, close, confirm };
}
