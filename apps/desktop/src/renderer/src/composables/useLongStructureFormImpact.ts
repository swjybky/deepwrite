import { shallowRef, watch } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";

export interface PendingLongStructureFormImpact {
  batch: LongWorkspaceOperationBatch;
  confirmation: LongWorkspaceImpactConfirmation;
}

export function useLongStructureFormImpact(options: {
  fields: () => readonly unknown[];
  mutationPending: () => boolean;
}) {
  // Batches and confirmations are sent through Electron IPC after confirmation.
  const pendingFormImpact = shallowRef<PendingLongStructureFormImpact | null>(
    null
  );

  watch(options.fields, () => {
    if (!options.mutationPending()) pendingFormImpact.value = null;
  });

  function clear(): void {
    pendingFormImpact.value = null;
  }

  function capture(
    batch: LongWorkspaceOperationBatch,
    confirmation: LongWorkspaceImpactConfirmation
  ): void {
    const { expectedImpact: _expectedImpact, ...unconfirmedBatch } = batch;
    pendingFormImpact.value = {
      batch: unconfirmedBatch,
      confirmation
    };
  }

  function confirmedBatch(): LongWorkspaceOperationBatch | null {
    const pending = pendingFormImpact.value;
    return pending
      ? { ...pending.batch, expectedImpact: pending.confirmation }
      : null;
  }

  return {
    pendingFormImpact,
    clearPendingFormImpact: clear,
    capturePendingFormImpact: capture,
    confirmedFormBatch: confirmedBatch
  };
}
