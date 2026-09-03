import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLongStoryPlotDeleteConfirmation } from "./useLongStoryPlotDeleteConfirmation";

const CONFIRMATION: LongWorkspaceImpactConfirmation = {
  impact: {
    createdEntityIds: [],
    updatedEntityIds: [],
    deletedEntityIds: ["storyplot_one"],
    createdFileIds: [],
    deletedFileIds: [],
    documentWriteProposalIds: []
  },
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

describe("useLongStoryPlotDeleteConfirmation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a story-plot impact cloneable through confirmation", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-31T08:00:00.000Z");
    let previewCompletion:
      ((impact?: LongWorkspaceImpactConfirmation) => void) | undefined;
    let previewed: LongWorkspaceOperationBatch | undefined;
    let submitted: LongWorkspaceOperationBatch | undefined;
    const confirmation = useLongStoryPlotDeleteConfirmation({
      currentReadOnly: computed(() => false),
      currentStoryPlots: computed(() => [{ id: "storyplot_one" }]),
      activeStoryPlotId: ref("storyplot_one"),
      ensureActiveSelection: async () => undefined,
      preview: (batch, completion) => {
        previewed = batch;
        previewCompletion = completion;
      },
      mutate: (batch) => {
        submitted = batch;
      }
    });

    confirmation.openStoryPlotDelete("storyplot_one");
    previewCompletion!(CONFIRMATION);

    expect(confirmation.pendingStoryPlotDeleteImpact.value).toBe(CONFIRMATION);
    expect(confirmation.pendingStoryPlotDeletePreviewPending.value).toBe(false);

    vi.setSystemTime("2026-08-31T08:01:00.000Z");
    confirmation.confirmStoryPlotDelete();
    expect(submitted?.expectedImpact).toBe(CONFIRMATION);
    expect(submitted?.updatedAt).toBe(previewed?.updatedAt);
    expect(() => structuredClone(submitted)).not.toThrow();
  });
});
