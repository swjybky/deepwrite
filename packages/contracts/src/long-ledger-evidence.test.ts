import { describe, expect, it } from "vitest";
import { LongLedgerCommitIndexEntrySchema } from "./long-workspace/ledger-index-entry";

const legacy = {
  id: "commit_evidence",
  mode: "text_files_batch",
  sequence: 1,
  chapterCardId: "chapter_one",
  chapterCardIds: ["chapter_one"],
  checkpointChapterCardId: "chapter_one",
  committedAt: "2026-11-14T00:00:00.000Z",
  placementIds: [],
  foreshadowingBeatIds: [],
  recordFile: {
    id: "file_commit_evidence:ledger",
    path: "long/ledger/commit_evidence.json",
    updatedAt: "2026-11-14T00:00:00.000Z"
  }
};
describe("ledger evidence compatibility", () => {
  it("leaves legacy evidence unknown and preserves new evidence through JSON roundtrip", () => {
    expect(
      LongLedgerCommitIndexEntrySchema.parse(legacy).bodyEvidence
    ).toBeUndefined();
    const current = {
      ...legacy,
      bodyEvidence: [{ chapterCardId: "chapter_one", sha256: "a".repeat(64) }],
      changedChapterIds: ["chapter_one"]
    };
    expect(
      LongLedgerCommitIndexEntrySchema.parse(
        JSON.parse(JSON.stringify(current))
      )
    ).toEqual(current);
  });
  it.each([
    { evidence: [] },
    { evidence: [{ chapterCardId: "chapter_one", sha256: "invalid" }] }
  ])("rejects invalid evidence %j", ({ evidence: bodyEvidence }) => {
    expect(
      LongLedgerCommitIndexEntrySchema.safeParse({ ...legacy, bodyEvidence })
        .success
    ).toBe(false);
  });
});
