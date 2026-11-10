import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import {
  agentProposalSupportsDiscard,
  textEditDiscardSnapshot
} from "./acceptedEditDiscard";

function acceptedTextProposal(
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceId: "book-1",
    stageId: "draft",
    documentId: "document-1",
    title: "第一章",
    summary: "修改正文",
    status: "accepted",
    baseRevision: "before-revision",
    proposedRevision: "after-revision",
    toolCallIds: ["tool-1"],
    additions: 1,
    deletions: 1,
    hunks: [],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
    discardSnapshot: {
      beforeText: "修改前",
      beforeTitle: "第一章"
    },
    ...overrides
  };
}

describe("accepted edit discard eligibility", () => {
  it("shows undo for an accepted restorable edit without requiring a tool trace", () => {
    const proposal = acceptedTextProposal();

    expect(agentProposalSupportsDiscard(proposal)).toBe(true);
    expect(
      agentProposalSupportsDiscard({
        ...proposal,
        status: "pending"
      })
    ).toBe(false);
    expect(
      agentProposalSupportsDiscard({
        ...proposal,
        discardSnapshot: { beforeTitle: "第一章" }
      })
    ).toBe(false);
  });

  it("keeps the original snapshot only while coalescing the same generation", () => {
    const existing = acceptedTextProposal();

    expect(
      textEditDiscardSnapshot(existing, true, "第一版修改后", "第一章")
    ).toEqual(existing.discardSnapshot);
    expect(
      textEditDiscardSnapshot(existing, false, "第一版修改后", "第一章")
    ).toEqual({
      beforeText: "第一版修改后",
      beforeTitle: "第一章"
    });
  });

  it("requires the previous plot structure fields before offering undo", () => {
    const proposal = acceptedTextProposal({
      plotStructureTarget: {
        mutation: {
          type: "update",
          stageId: "plot_design",
          previousTitle: "剧情设计",
          title: "新剧情设计",
          description: "新说明"
        }
      },
      discardSnapshot: {
        beforeText: "旧说明",
        beforeTitle: "剧情设计",
        beforeDescription: "旧说明"
      }
    });

    expect(agentProposalSupportsDiscard(proposal)).toBe(true);
    expect(
      agentProposalSupportsDiscard({
        ...proposal,
        discardSnapshot: { beforeTitle: "剧情设计" }
      })
    ).toBe(false);
  });

  it("never enables discard for short-form creation proposals", () => {
    expect(
      agentProposalSupportsDiscard({
        ...acceptedTextProposal(),
        libraryTarget: {
          operation: "create",
          domain: "material",
          libraryId: "library-1"
        }
      })
    ).toBe(false);
    expect(
      agentProposalSupportsDiscard({
        ...acceptedTextProposal(),
        draftSectionCreationTarget: {
          sections: [
            {
              title: "新章节",
              wordCountRequirement: "1000 字",
              provisionalSectionId: "section-1"
            }
          ]
        }
      })
    ).toBe(false);
  });

  it("enables discard for a long-form proposal only with a restore point", () => {
    const longProposal = {
      ...acceptedTextProposal(),
      stageId: "long-plot-design" as const,
      workspaceId: "long:book-1",
      longPlotDesignTarget: {
        bookId: "book-1",
        batch: {
          updatedAt: "2026-08-25T00:00:00.000Z",
          operations: [
            { type: "worldbuilding.delete" as const, id: "world_rules" }
          ],
          documentWrites: []
        }
      }
    };
    expect(agentProposalSupportsDiscard(longProposal)).toBe(false);
    const restorable = {
      ...longProposal,
      discardSnapshot: { longRestorePointId: "restore_abc12345" }
    };
    expect(agentProposalSupportsDiscard(restorable)).toBe(true);
    expect(
      agentProposalSupportsDiscard({
        ...restorable,
        discardState: {
          status: "discarded",
          message: "已撤销",
          updatedAt: "2026-08-25T00:00:02.000Z"
        }
      })
    ).toBe(false);
  });
});
