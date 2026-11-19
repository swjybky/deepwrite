import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LONG_BOOK_LINE_FILE_ID,
  longChapterCardFileId,
  longChapterFilePath,
  serializeLongForeshadowingBody,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { fileChangeSummary } from "../components/conversationFileChanges";
import {
  agentEditProposalId,
  agentEditProposalLaneId
} from "./agentEditReview";
import { editedProposalPatch, proposalEditBaseText } from "./agentProposalEdit";
import { buildAgentTextDiff } from "./agentTextDiff";
import {
  deriveLongMutationReviewFromBatch,
  findSameRunLongPrerequisites
} from "./longMutationProposal";
import { createLongProposalRecoveryFixture } from "../composables/useProposalCoordinator.long-recovery.test-support";
import type { AgentEditProposal } from "../types/conversation";

const NOW = "2026-11-17T08:00:00.000Z";
const SHA_A = "a".repeat(64);

afterEach(() => vi.unstubAllGlobals());

function makePlotProposal(
  id: string,
  batch: LongWorkspaceOperationBatch,
  patch: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  const review = deriveLongMutationReviewFromBatch(batch);
  const diff = review?.content
    ? buildAgentTextDiff(review.content.beforeText, review.content.afterText)
    : { additions: 0, deletions: 0, hunks: [], truncated: false };
  const documentId = review?.targetKey ?? "plot-design";
  const laneId = agentEditProposalId(
    "run_1",
    "long:longbook_test",
    "long-plot-design",
    documentId
  );
  return {
    id,
    laneId,
    generation: 1,
    approvalMode: "request-approval",
    runId: "run_1",
    workspaceId: "long:longbook_test",
    stageId: "long-plot-design",
    documentId,
    title: review?.title ?? "剧情设计",
    summary: "调整",
    status: "pending",
    proposedText: review?.content?.afterText ?? "调整",
    toolCallIds: [`tool_${id}`],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    createdAt: NOW,
    updatedAt: NOW,
    longPlotDesignTarget: {
      bookId: "longbook_test",
      batch,
      ...(review ? { review } : {})
    },
    ...patch
  };
}

describe("longMutationProposal & agentProposalEdit", () => {
  it("derives per-target review metadata and isolates laneIds by target", () => {
    const cardAId = longChapterCardFileId("chapter_a");
    const cardBId = longChapterCardFileId("chapter_b");
    const propA = makePlotProposal("prop_a", {
      updatedAt: NOW,
      operations: [],
      documentWrites: [
        {
          proposalId: "proposal_a",
          mode: "replace",
          fileId: cardAId,
          content: "第一章卡内容",
          updatedAt: NOW,
          reason: "写第一章卡"
        }
      ]
    });
    const propB = makePlotProposal("prop_b", {
      updatedAt: NOW,
      operations: [],
      documentWrites: [
        {
          proposalId: "proposal_b",
          mode: "replace",
          fileId: cardBId,
          content: "第二章卡内容",
          updatedAt: NOW,
          reason: "写第二章卡"
        }
      ]
    });
    const deleteProp = makePlotProposal("prop_del", {
      updatedAt: NOW,
      operations: [{ type: "arc.delete", id: "arc_old" }],
      documentWrites: []
    });
    const foreshadowProp = makePlotProposal("prop_f", {
      updatedAt: NOW,
      operations: [
        {
          type: "foreshadowing.create",
          thread: {
            id: "foreshadow_one",
            title: "密信",
            coreQuestion: "谁寄出了密信？",
            hiddenTruth: "二叔",
            plannedSpan: "within_volume",
            truthEventId: null,
            expectedReaderEffect: "悬疑感",
            status: "planned",
            beats: []
          }
        }
      ],
      documentWrites: []
    });

    expect(propA.longPlotDesignTarget?.review?.targetKind).toBe("chapter_card");
    expect(agentEditProposalLaneId(propA)).not.toBe(
      agentEditProposalLaneId(propB)
    );
    expect(
      foreshadowProp.longPlotDesignTarget?.review?.content?.afterText
    ).toBe(
      serializeLongForeshadowingBody({
        coreQuestion: "谁寄出了密信？",
        hiddenTruth: "二叔",
        expectedReaderEffect: "悬疑感"
      })
    );

    const toApproval = (proposal: AgentEditProposal) => ({
      id: `edit:${proposal.id}`,
      type: "edit-proposal" as const,
      createdAt: proposal.createdAt,
      toolCallIds: proposal.toolCallIds,
      canDiscard: false,
      proposal
    });
    const summary = fileChangeSummary([
      toApproval(propA),
      toApproval(propB),
      toApproval(deleteProp)
    ]);
    expect(summary.rows).toHaveLength(3);
    expect(summary.rows[0]?.kind).toBe("text");
    expect(summary.rows[2]?.kind).toBe("structure");
    expect(summary.rows[2]?.deletes).toBe(true);
    expect(summary.rows[2]?.additions).toBeUndefined();
  });

  it("finds same-run prerequisites only for creations the batch actually references", () => {
    const createArc = makePlotProposal("prop_arc", {
      updatedAt: NOW,
      operations: [
        {
          type: "arc.create",
          arc: {
            id: "arc_new",
            volumeId: "volume_one",
            title: "新剧情点",
            order: 1,
            outline: ""
          }
        }
      ],
      documentWrites: []
    });
    const dependentChapterBatch: LongWorkspaceOperationBatch = {
      updatedAt: NOW,
      operations: [
        {
          type: "chapter.move",
          id: "chapter_one",
          toVolumeId: "volume_one",
          toPrimaryArcId: "arc_new"
        }
      ],
      documentWrites: []
    };
    const unrelatedBookLineBatch: LongWorkspaceOperationBatch = {
      updatedAt: NOW,
      operations: [],
      documentWrites: [
        {
          proposalId: "proposal_bl",
          mode: "replace",
          fileId: LONG_BOOK_LINE_FILE_ID,
          content: "# 全书故事线",
          updatedAt: NOW,
          reason: "更新故事线"
        }
      ]
    };

    expect(
      findSameRunLongPrerequisites([createArc], dependentChapterBatch).map(
        ({ id }) => id
      )
    ).toEqual(["prop_arc"]);
    expect(
      findSameRunLongPrerequisites([createArc], unrelatedBookLineBatch)
    ).toEqual([]);
  });

  it("supports in-card user editing on chapter card and foreshadowing prose and rejects pure structure edits", () => {
    const cardFileId = longChapterCardFileId("chapter_one");
    const cardProposal = makePlotProposal(
      "prop_edit_card",
      {
        updatedAt: NOW,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_edit_card",
            mode: "replace",
            fileId: cardFileId,
            content: "## 目标\n初稿",
            updatedAt: NOW,
            reason: "更新章卡",
            expectedSha256: SHA_A
          }
        ],
        expectedImpact: {
          impact: {
            createdEntityIds: [],
            updatedEntityIds: [],
            deletedEntityIds: [],
            createdFileIds: [],
            deletedFileIds: [],
            documentWriteProposalIds: ["proposal_edit_card"]
          },
          entityChanges: [],
          relationshipChanges: [],
          fileIntents: [],
          ledgerRecordEdits: []
        }
      },
      {
        longPlotDesignTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: NOW,
            operations: [],
            documentWrites: [
              {
                proposalId: "proposal_edit_card",
                mode: "replace",
                fileId: cardFileId,
                content: "## 目标\n初稿",
                updatedAt: NOW,
                reason: "更新章卡",
                expectedSha256: SHA_A
              }
            ]
          },
          review: {
            targetKey: `doc:${cardFileId}`,
            targetKind: "chapter_card",
            targetId: "chapter_one",
            action: "edit",
            title: "第一章 / 章卡",
            content: {
              fileId: cardFileId,
              filePath: longChapterFilePath("chapter_one", "card.md"),
              operation: "write",
              beforeText: "## 目标\n原稿",
              afterText: "## 目标\n初稿"
            }
          }
        }
      }
    );

    expect(proposalEditBaseText(cardProposal)).toBe("## 目标\n原稿");
    const editedCard = editedProposalPatch(cardProposal, "## 目标\n用户改写稿");
    expect(editedCard).toBeDefined();
    expect(editedCard?.userEditedText).toBe("## 目标\n用户改写稿");
    expect(
      editedCard?.longPlotDesignTarget?.batch.documentWrites[0]?.content
    ).toBe("## 目标\n用户改写稿");
    expect(editedCard?.longPlotDesignTarget?.review?.content?.afterText).toBe(
      "## 目标\n用户改写稿"
    );
    expect(editedCard?.longPlotDesignTarget?.expectedImpact).toBeUndefined();
    expect(editedCard?.additions).toBeGreaterThan(0);

    const oldBody = serializeLongForeshadowingBody({
      coreQuestion: "旧悬念",
      hiddenTruth: "旧真相",
      expectedReaderEffect: "旧效果"
    });
    const foreshadowProposal = makePlotProposal(
      "prop_edit_f",
      {
        updatedAt: NOW,
        operations: [
          {
            type: "foreshadowing.update",
            id: "foreshadow_one",
            patch: {
              coreQuestion: "旧悬念",
              hiddenTruth: "旧真相",
              expectedReaderEffect: "旧效果"
            }
          }
        ],
        documentWrites: []
      },
      {
        longPlotDesignTarget: {
          bookId: "longbook_test",
          batch: {
            updatedAt: NOW,
            operations: [
              {
                type: "foreshadowing.update",
                id: "foreshadow_one",
                patch: {
                  coreQuestion: "旧悬念",
                  hiddenTruth: "旧真相",
                  expectedReaderEffect: "旧效果"
                }
              }
            ],
            documentWrites: []
          },
          review: {
            targetKey: "entity:foreshadow_one",
            targetKind: "foreshadowing",
            targetId: "foreshadow_one",
            action: "edit",
            title: "伏笔线 · 玉佩来历",
            content: {
              operation: "write",
              beforeText: "",
              afterText: oldBody
            }
          }
        }
      }
    );
    expect(proposalEditBaseText(foreshadowProposal)).toBe("");
    const nextBody = serializeLongForeshadowingBody({
      coreQuestion: "新悬念",
      hiddenTruth: "新真相",
      expectedReaderEffect: "新效果"
    });
    const editedForeshadow = editedProposalPatch(foreshadowProposal, nextBody);
    const op = editedForeshadow?.longPlotDesignTarget?.batch.operations[0];
    expect(op?.type).toBe("foreshadowing.update");
    if (op?.type === "foreshadowing.update") {
      expect(op.patch.coreQuestion).toBe("新悬念");
      expect(op.patch.hiddenTruth).toBe("新真相");
      expect(op.patch.expectedReaderEffect).toBe("新效果");
    }

    const linkOnlyProposal = makePlotProposal("prop_link", {
      updatedAt: NOW,
      operations: [
        {
          type: "chapter.move",
          id: "chapter_one",
          toVolumeId: "volume_one",
          toPrimaryArcId: "arc_new"
        }
      ],
      documentWrites: []
    });
    expect(proposalEditBaseText(linkOnlyProposal)).toBeUndefined();
  });

  it("applies non-destructive plot design edits in one click without 2-step confirmation", async () => {
    const cardFileId = longChapterCardFileId("chapter_one");
    const nonDestructive = makePlotProposal(
      "proposal-long-non-destructive",
      {
        updatedAt: NOW,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_card_1",
            mode: "replace",
            fileId: cardFileId,
            content: "更新后的章卡",
            updatedAt: NOW,
            reason: "细化章卡"
          }
        ]
      },
      {
        runId: "run-long-delete",
        workspaceId: "long:longbook_delete",
        longPlotDesignTarget: {
          bookId: "longbook_delete",
          batch: {
            updatedAt: NOW,
            operations: [],
            documentWrites: [
              {
                proposalId: "proposal_card_1",
                mode: "replace",
                fileId: cardFileId,
                content: "更新后的章卡",
                updatedAt: NOW,
                reason: "细化章卡"
              }
            ]
          }
        }
      }
    );
    const fixture = createLongProposalRecoveryFixture([nonDestructive]);
    try {
      await fixture.coordinator.reviewLongAgentEdit({
        runId: "run-long-delete",
        proposalId: "proposal-long-non-destructive",
        decision: "accept"
      });
      await fixture.coordinator.drain();
      expect(fixture.proposal("proposal-long-non-destructive").status).toBe(
        "accepted"
      );
      expect(fixture.applyOperations).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.coordinator.dispose();
    }
  });
});
