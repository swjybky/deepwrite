import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { ref, shallowRef, type ComputedRef, type Ref } from "vue";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";

interface Options {
  currentReadOnly: ComputedRef<boolean>;
  currentStoryPlots: ComputedRef<Array<{ id: string }>>;
  activeStoryPlotId: Ref<string | null>;
  ensureActiveSelection(): Promise<void>;
  preview(
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): void;
  mutate(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): void;
}

export function useLongStoryPlotDeleteConfirmation(options: Options) {
  const pendingStoryPlotDeleteId = ref<string | null>(null);
  const pendingStoryPlotDeleteImpact =
    shallowRef<LongWorkspaceImpactConfirmation>();
  const pendingStoryPlotDeletePreviewPending = ref(false);
  const pendingStoryPlotDeletePending = ref(false);
  let requestId = 0;
  let operationUpdatedAt: string | undefined;

  function deleteBatch(
    storyPlotId: string,
    updatedAt: string,
    expectedImpact?: LongWorkspaceImpactConfirmation
  ): LongWorkspaceOperationBatch {
    return {
      updatedAt,
      operations: [{ type: "storyPlot.delete", id: storyPlotId }],
      documentWrites: [],
      ...(expectedImpact ? { expectedImpact } : {})
    };
  }

  function openStoryPlotDelete(storyPlotId: string): void {
    if (
      options.currentReadOnly.value ||
      !options.currentStoryPlots.value.some(({ id }) => id === storyPlotId)
    ) {
      return;
    }
    const request = ++requestId;
    const updatedAt = new Date().toISOString();
    operationUpdatedAt = updatedAt;
    pendingStoryPlotDeleteId.value = storyPlotId;
    pendingStoryPlotDeleteImpact.value = undefined;
    pendingStoryPlotDeletePending.value = false;
    pendingStoryPlotDeletePreviewPending.value = true;
    options.preview(deleteBatch(storyPlotId, updatedAt), (expectedImpact) => {
      if (
        request !== requestId ||
        pendingStoryPlotDeleteId.value !== storyPlotId
      ) {
        return;
      }
      pendingStoryPlotDeletePreviewPending.value = false;
      pendingStoryPlotDeleteImpact.value = expectedImpact;
    });
  }

  function cancelStoryPlotDelete(): void {
    if (pendingStoryPlotDeletePending.value) return;
    requestId += 1;
    pendingStoryPlotDeleteId.value = null;
    pendingStoryPlotDeleteImpact.value = undefined;
    pendingStoryPlotDeletePreviewPending.value = false;
    operationUpdatedAt = undefined;
  }

  function confirmStoryPlotDelete(): void {
    const storyPlotId = pendingStoryPlotDeleteId.value;
    const expectedImpact = pendingStoryPlotDeleteImpact.value;
    const updatedAt = operationUpdatedAt;
    if (
      !storyPlotId ||
      !expectedImpact ||
      !updatedAt ||
      pendingStoryPlotDeletePreviewPending.value ||
      pendingStoryPlotDeletePending.value
    ) {
      return;
    }
    pendingStoryPlotDeletePending.value = true;
    options.mutate(deleteBatch(storyPlotId, updatedAt, expectedImpact), {
      succeed() {
        pendingStoryPlotDeletePending.value = false;
        cancelStoryPlotDelete();
        if (options.activeStoryPlotId.value === storyPlotId) {
          options.activeStoryPlotId.value = null;
          void options.ensureActiveSelection();
        }
      },
      fail(_message, changedImpact) {
        pendingStoryPlotDeletePending.value = false;
        if (changedImpact) pendingStoryPlotDeleteImpact.value = changedImpact;
      },
      appliedButRefreshFailed() {
        pendingStoryPlotDeletePending.value = false;
        cancelStoryPlotDelete();
        if (options.activeStoryPlotId.value === storyPlotId) {
          options.activeStoryPlotId.value = null;
        }
      }
    });
  }

  return {
    pendingStoryPlotDeleteId,
    pendingStoryPlotDeleteImpact,
    pendingStoryPlotDeletePreviewPending,
    pendingStoryPlotDeletePending,
    openStoryPlotDelete,
    cancelStoryPlotDelete,
    confirmStoryPlotDelete
  };
}
