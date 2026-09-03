import { computed, ref, shallowRef, type ComputedRef } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { createLongStructureMutationBuilder } from "../types/longStructureMutations";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";

interface ThreadTarget {
  id: string;
  title: string;
  beats: readonly { id: string }[];
}

interface BeatTarget {
  id: string;
}

export type LongForeshadowingDeleteTarget = (
  | { kind: "thread"; thread: ThreadTarget }
  | { kind: "beat"; thread: ThreadTarget; beat: BeatTarget }
) & {
  batch: LongWorkspaceOperationBatch;
  previewPending: boolean;
  expectedImpact?: LongWorkspaceImpactConfirmation;
};

interface Options {
  snapshot: ComputedRef<LongWorkspaceIndexSnapshot>;
  locked: () => boolean;
  threadLocked(thread: ThreadTarget): boolean;
  beatLocked(beat: BeatTarget): boolean;
  rememberFocus(): void;
  restoreFocus(): void;
  preview(
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): void;
  mutate(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): void;
  notify: {
    info(message: string): void;
    warning(message: string): void;
  };
}

export function useLongForeshadowingDeleteConfirmation(options: Options) {
  // The target is compared by identity and later crosses the Electron IPC boundary.
  const deleteTarget = shallowRef<LongForeshadowingDeleteTarget | null>(null);
  const submitting = ref(false);
  const deleteTitle = computed(() => {
    const target = deleteTarget.value;
    return target?.kind === "thread"
      ? `删除伏笔线“${target.thread.title}”`
      : target
        ? "删除伏笔触点"
        : "删除伏笔";
  });

  function reset(restoreFocus = true): void {
    deleteTarget.value = null;
    submitting.value = false;
    if (restoreFocus) options.restoreFocus();
  }

  function requestDelete(
    target:
      | { kind: "thread"; thread: ThreadTarget }
      | { kind: "beat"; thread: ThreadTarget; beat: BeatTarget }
  ): void {
    try {
      const builder = createLongStructureMutationBuilder(
        options.snapshot.value
      );
      const batch =
        target.kind === "thread"
          ? builder.deleteForeshadowing(target.thread.id)
          : builder.deleteForeshadowingBeat(target.beat.id);
      const pending: LongForeshadowingDeleteTarget = {
        ...target,
        batch,
        previewPending: true
      };
      deleteTarget.value = pending;
      options.preview(batch, (expectedImpact) => {
        if (deleteTarget.value !== pending) return;
        if (!expectedImpact) {
          reset();
          return;
        }
        deleteTarget.value = {
          ...pending,
          previewPending: false,
          expectedImpact
        };
      });
    } catch (error: unknown) {
      options.notify.warning(
        error instanceof Error ? error.message : "无法读取伏笔删除影响。"
      );
      options.restoreFocus();
    }
  }

  function requestDeleteThread(thread: ThreadTarget): void {
    if (options.locked()) return;
    if (options.threadLocked(thread)) {
      options.notify.info("该伏笔线正在处理其它变更，请稍后重试。");
      return;
    }
    options.rememberFocus();
    requestDelete({ kind: "thread", thread });
  }

  function requestDeleteBeat(thread: ThreadTarget, beat: BeatTarget): void {
    if (options.locked()) return;
    if (options.beatLocked(beat)) {
      options.notify.info("该触点正在处理其它变更，请稍后重试。");
      return;
    }
    options.rememberFocus();
    requestDelete({ kind: "beat", thread, beat });
  }

  function closeDelete(): void {
    if (options.locked() || submitting.value) return;
    reset();
  }

  function confirmDelete(): void {
    const target = deleteTarget.value;
    if (
      !target ||
      target.previewPending ||
      !target.expectedImpact ||
      submitting.value
    ) {
      return;
    }
    submitting.value = true;
    options.mutate(
      { ...target.batch, expectedImpact: target.expectedImpact },
      {
        succeed: () => reset(),
        fail: (_message, changedImpact) => {
          submitting.value = false;
          if (!changedImpact || deleteTarget.value !== target) return;
          deleteTarget.value = {
            ...target,
            previewPending: false,
            expectedImpact: changedImpact
          };
        },
        appliedButRefreshFailed: () => reset()
      }
    );
  }

  return {
    deleteTarget,
    deleteTitle,
    deleteSubmitting: submitting,
    requestDeleteThread,
    requestDeleteBeat,
    closeDelete,
    confirmDelete
  };
}
