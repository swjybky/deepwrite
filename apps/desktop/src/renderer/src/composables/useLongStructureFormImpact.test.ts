import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { useLongStructureFormImpact } from "./useLongStructureFormImpact";

const CONFIRMATION: LongWorkspaceImpactConfirmation = {
  impact: {
    createdEntityIds: [],
    updatedEntityIds: [],
    deletedEntityIds: ["chapter_one"],
    createdFileIds: [],
    deletedFileIds: [],
    documentWriteProposalIds: []
  },
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

const BATCH: LongWorkspaceOperationBatch = {
  updatedAt: "2026-08-31T06:00:00.000Z",
  operations: [{ type: "chapter.delete", id: "chapter_one" }],
  documentWrites: []
};

describe("useLongStructureFormImpact", () => {
  it("keeps a confirmed form batch cloneable for Electron IPC", () => {
    const impact = useLongStructureFormImpact({
      fields: () => [],
      mutationPending: () => false
    });

    impact.capturePendingFormImpact(BATCH, CONFIRMATION);
    const confirmed = impact.confirmedFormBatch();

    expect(confirmed?.expectedImpact).toBe(CONFIRMATION);
    expect(() => structuredClone(confirmed)).not.toThrow();
  });
});
