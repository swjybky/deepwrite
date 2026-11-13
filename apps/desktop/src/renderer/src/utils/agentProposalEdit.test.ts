import { describe, expect, it } from "vitest";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../types/conversation";
import { buildAgentTextDiff } from "./agentTextDiff";
import { editedProposalPatch, proposalEditBaseText } from "./agentProposalEdit";

const before = [
  "第一段。",
  "第二段。",
  "第三段。",
  "第四段。",
  "第五段。"
].join("\n");
const agent = [
  "第一段。",
  "第二段改写。",
  "第三段。",
  "第五段。",
  "新尾声。"
].join("\n");

function shortProposal(
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  const diff = buildAgentTextDiff(before, agent);
  return {
    id: "proposal_1",
    runId: "run",
    workspaceId: "book",
    stageId: "draft",
    documentId: "doc",
    title: "第一节",
    summary: "改写第二段",
    status: "pending",
    baseRevision: createShortWorkspaceContentRevision(before),
    proposedRevision: createShortWorkspaceContentRevision(agent),
    proposedText: agent,
    toolCallIds: ["call_1"],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

describe("editing a proposal before accepting it", () => {
  it("recovers the original text from the diff and rebuilds it for the user's version", () => {
    const proposal = shortProposal();
    expect(proposalEditBaseText(proposal)).toBe(before);

    const mine = agent.replace("新尾声。", "我的尾声。");
    const patch = editedProposalPatch(proposal, mine)!;
    expect(patch).toMatchObject({
      proposedText: mine,
      proposedRevision: createShortWorkspaceContentRevision(mine),
      userEditedText: mine
    });
    expect(patch.hunks).toEqual(buildAgentTextDiff(before, mine).hunks);
  });

  it("recovers the base for creations and pure deletions", () => {
    const created = shortProposal({
      proposedText: "全新内容",
      hunks: buildAgentTextDiff("", "全新内容").hunks
    });
    expect(proposalEditBaseText(created)).toBe("");
    const trimmed = "第一段。\n第五段。";
    const deletion = shortProposal({
      proposedText: trimmed,
      hunks: buildAgentTextDiff(before, trimmed).hunks
    });
    expect(proposalEditBaseText(deletion)).toBe(before);
  });

  it("only edits pending text proposals whose base is known", () => {
    expect(proposalEditBaseText(shortProposal({ status: "accepted" }))).toBe(
      undefined
    );
    expect(proposalEditBaseText(shortProposal({ truncated: true }))).toBe(
      undefined
    );
    expect(
      proposalEditBaseText(
        shortProposal({
          draftSectionRenameTarget: {
            sectionId: "s",
            previousTitle: "旧",
            title: "新"
          }
        })
      )
    ).toBe(undefined);
    // A diff that does not describe the proposed text is not trusted.
    expect(
      proposalEditBaseText(shortProposal({ proposedText: "别的内容" }))
    ).toBe(undefined);
  });

  it("rewrites a long chapter's batch and asks for the impact again", () => {
    const file = {
      chapterCardId: "chapter_1",
      chapterTitle: "第一章",
      fileId: "file_body",
      filePath: "chapters/1.md",
      operation: "write" as const,
      beforeText: before,
      afterText: agent
    };
    const proposal = shortProposal({
      stageId: "long-draft",
      longDraftTarget: {
        bookId: "longbook",
        batch: {
          updatedAt: "2026-11-12T00:00:00.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_body",
              fileId: "file_body",
              content: agent,
              updatedAt: "2026-11-12T00:00:00.000Z",
              reason: "写正文",
              mode: "replace"
            }
          ]
        },
        file,
        expectedImpact: {} as never
      }
    });
    const patch = editedProposalPatch(proposal, "我的正文")!;
    expect(patch.longDraftTarget?.batch.documentWrites[0]?.content).toBe(
      "我的正文"
    );
    expect(patch.longDraftTarget?.file.afterText).toBe("我的正文");
    expect(patch.longDraftTarget).not.toHaveProperty("expectedImpact");
  });
});
