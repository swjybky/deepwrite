import { replaceLongBookSummary } from "../types/longWorkspace";
import type { LongBookLifecycleCoordinatorOptions } from "./longBookLifecycleTypes";

interface Options extends Pick<
  LongBookLifecycleCoordinatorOptions,
  "api" | "state" | "session" | "workflow" | "catalog" | "notifications"
> {
  isDisposed(): boolean;
  runTracked(task: () => Promise<void>): Promise<void>;
}

export function useLongConflictResolution(options: Options) {
  const { state, notifications, session, workflow, catalog } = options;
  return async (bookId: string): Promise<void> => {
    if (
      options.isDisposed() ||
      state.bookActionPending.value ||
      state.mutationPending.value
    )
      return;
    const api = options.api();
    if (!api) return;
    state.bookActionPending.value = true;
    state.mutationPending.value = true;
    await options.runTracked(async () => {
      let resolved = false;
      try {
        await workflow.stopBookAgentRuns(bookId);
        if (options.isDisposed()) return;
        session.invalidateWorkspaceRefresh(bookId);
        // Saving first would hit the same blocked recovery and make this
        // action unreachable. Keep editor drafts while repairing disk state.
        const result = await api.resolveConflicts({ bookId });
        resolved = true;
        if (options.isDisposed()) return;
        // Invalidate any list response captured while recovery was blocked
        // before publishing the repaired summary or awaiting a workspace read.
        await catalog.loadBookList({ force: true });
        if (options.isDisposed()) return;
        state.longBooks.value = replaceLongBookSummary(
          state.longBooks.value,
          result.summary
        );
        if (state.activeBookId.value === bookId) {
          if (!(await session.refreshActiveWorkspace(bookId))) {
            notifications.warning(
              "文件冲突已解决，但工作区刷新失败，请重新打开这本长篇。"
            );
            return;
          }
        }
        await catalog.refreshWorkspaceDirectory();
        if (options.isDisposed()) return;
        notifications.success(
          result.resolvedPaths.length
            ? `已解决 ${result.resolvedPaths.length} 处文件冲突，已保留磁盘修改和恢复备份，可以继续操作`
            : "已同步磁盘状态，可以继续操作"
        );
      } catch (error: unknown) {
        if (!options.isDisposed()) {
          const detail =
            error instanceof Error ? error.message : "请稍后重试。";
          notifications.error(
            `${resolved ? "文件冲突已解决，但刷新失败" : "解决冲突失败"}：${detail}`
          );
        }
      } finally {
        state.bookActionPending.value = false;
        state.mutationPending.value = false;
      }
    });
  };
}
