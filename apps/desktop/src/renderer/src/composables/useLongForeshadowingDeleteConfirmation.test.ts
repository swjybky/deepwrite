import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { computed } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useLongForeshadowingDeleteConfirmation } from "./useLongForeshadowingDeleteConfirmation";

const CONFIRMATION: LongWorkspaceImpactConfirmation = {
  impact: {
    createdEntityIds: [],
    updatedEntityIds: [],
    deletedEntityIds: ["foreshadow_thread"],
    createdFileIds: [],
    deletedFileIds: [],
    documentWriteProposalIds: []
  },
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

describe("useLongForeshadowingDeleteConfirmation", () => {
  it("settles the current preview and submits a cloneable batch", () => {
    const previewCompletions: Array<
      (impact?: LongWorkspaceImpactConfirmation) => void
    > = [];
    let submitted: LongWorkspaceOperationBatch | undefined;
    const confirmation = useLongForeshadowingDeleteConfirmation({
      snapshot: computed(
        () =>
          ({
            plot: { foreshadowing: [] }
          }) as unknown as LongWorkspaceIndexSnapshot
      ),
      locked: () => false,
      threadLocked: () => false,
      beatLocked: () => false,
      rememberFocus: vi.fn(),
      restoreFocus: vi.fn(),
      preview: (_batch, completion) => previewCompletions.push(completion),
      mutate: (batch) => {
        submitted = batch;
      },
      notify: { info: vi.fn(), warning: vi.fn() }
    });

    confirmation.requestDeleteThread({
      id: "foreshadow_thread",
      title: "失声的钟",
      beats: []
    });
    previewCompletions[0]!(CONFIRMATION);

    expect(confirmation.deleteTarget.value).toMatchObject({
      previewPending: false,
      expectedImpact: CONFIRMATION
    });
    expect(confirmation.deleteTarget.value?.expectedImpact).toBe(CONFIRMATION);

    confirmation.confirmDelete();
    expect(submitted?.expectedImpact).toBe(CONFIRMATION);
    expect(() => structuredClone(submitted)).not.toThrow();
  });
});
