import type { LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  isLongDocumentChanged,
  longStaleBaseChanged,
  staleLongProposalPatch,
  withConfirmedDocumentHashes
} from "./long-stale-base";

const AGENT_SHA = "a".repeat(64);
const DISK_SHA = "b".repeat(64);
const NEWER_SHA = "c".repeat(64);

function changed(fileId: string, actualSha256: string) {
  return {
    code: "long.operation.document_changed",
    message: "文档在智能体读取后已被修改，未覆盖当前内容。",
    details: {
      fileId,
      actualSha256,
      kind: "LongWorkspaceOperationError",
      operationCode: "document_changed"
    }
  };
}

const batch: LongWorkspaceOperationBatch = {
  updatedAt: "2026-10-19T01:00:00.000Z",
  operations: [],
  documentWrites: [
    {
      proposalId: "proposal_body",
      fileId: "file_body",
      content: "智能体版本",
      mode: "replace",
      expectedSha256: AGENT_SHA,
      updatedAt: "2026-10-19T01:00:00.000Z",
      reason: "校对"
    },
    {
      proposalId: "proposal_new",
      fileId: "file_new",
      content: "新文件",
      mode: "create",
      updatedAt: "2026-10-19T01:00:00.000Z",
      reason: "新建"
    }
  ]
};

describe("long proposal base checks", () => {
  it("recognizes Core's document change rejection only", () => {
    expect(isLongDocumentChanged(changed("file_body", DISK_SHA))).toBe(true);
    expect(
      isLongDocumentChanged({
        code: "long.operation.impact_mismatch",
        message: "impact"
      })
    ).toBe(false);
  });

  it("holds the proposal and remembers the version Core reported", () => {
    const patch = staleLongProposalPatch(
      {},
      changed("file_body", DISK_SHA),
      "t1"
    );
    expect(patch).toEqual({
      status: "pending",
      approvalMode: "request-approval",
      staleBase: {
        detectedAt: "t1",
        currentSha256ByFileId: { file_body: DISK_SHA }
      }
    });
    const proposal = { staleBase: patch.staleBase! };
    expect(longStaleBaseChanged(proposal, changed("file_body", DISK_SHA))).toBe(
      false
    );
    expect(
      longStaleBaseChanged(proposal, changed("file_body", NEWER_SHA))
    ).toBe(true);
    expect(
      staleLongProposalPatch(proposal, changed("file_body", NEWER_SHA), "t2")
        .staleBase
    ).toEqual({
      detectedAt: "t1",
      currentSha256ByFileId: { file_body: NEWER_SHA }
    });
  });

  it("overwrites by expecting the confirmed versions, never by forcing", () => {
    expect(withConfirmedDocumentHashes(batch, {})).toBe(batch);
    const confirmed = withConfirmedDocumentHashes(batch, {
      staleBase: {
        detectedAt: "t1",
        currentSha256ByFileId: { file_body: DISK_SHA, file_new: NEWER_SHA }
      }
    });
    expect(confirmed.documentWrites[0]).toMatchObject({
      fileId: "file_body",
      expectedSha256: DISK_SHA
    });
    expect(confirmed.documentWrites[1]).toEqual(batch.documentWrites[1]);
    expect(batch.documentWrites[0]).toMatchObject({
      expectedSha256: AGENT_SHA
    });
  });
});
