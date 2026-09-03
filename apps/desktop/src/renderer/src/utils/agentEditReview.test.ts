import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import {
  agentEditProposalGenerationId,
  agentEditProposalId,
  agentEditProposalLaneId,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision,
  latestAgentEditProposalInLane,
  resolveAgentEditProposalGeneration,
  resolveAgentEditorMutationText
} from "./agentEditReview";

function proposal(
  baseText: string,
  proposedText: string | undefined
): AgentEditProposal {
  return {
    baseRevision: createShortWorkspaceContentRevision(baseText),
    proposedRevision: createShortWorkspaceContentRevision(proposedText ?? ""),
    ...(proposedText === undefined ? {} : { proposedText })
  } as AgentEditProposal;
}

describe("agent edit review", () => {
  it("builds a stable proposal id that separates physical target files", () => {
    expect(agentEditProposalId("run-1", "book-1", "draft", "body:file/1")).toBe(
      "run-1:book-1:draft:body%3Afile%2F1"
    );
  });

  it("creates a distinct immutable id after an earlier generation is applying", () => {
    const laneId = agentEditProposalId(
      "run-1",
      "book-1",
      "draft",
      "body:file/1"
    );
    const existing = {
      ...proposal("原文", "第一版"),
      id: laneId,
      laneId,
      generation: 1,
      status: "accepting",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } as AgentEditProposal;

    expect(resolveAgentEditProposalGeneration(laneId, existing)).toEqual({
      id: agentEditProposalGenerationId(laneId, 2),
      laneId,
      generation: 2,
      coalescesExisting: false,
      predecessorProposalId: laneId
    });
  });

  it("coalesces repeated undecided mutations in the same generation", () => {
    const existing = {
      ...proposal("原文", "第一版"),
      id: "lane",
      laneId: "lane",
      generation: 3,
      status: "pending",
      predecessorProposalId: "lane:g2"
    } as AgentEditProposal;

    expect(resolveAgentEditProposalGeneration("lane", existing)).toEqual({
      id: "lane",
      laneId: "lane",
      generation: 3,
      coalescesExisting: true,
      predecessorProposalId: "lane:g2"
    });
  });

  it("finds the latest immutable generation in a lane", () => {
    const first = {
      ...proposal("原文", "第一版"),
      id: "lane",
      laneId: "lane",
      generation: 1,
      updatedAt: "2026-01-01T00:00:00.000Z"
    } as AgentEditProposal;
    const second = {
      ...proposal("第一版", "第二版"),
      id: "lane:generation:2",
      laneId: "lane",
      generation: 2,
      updatedAt: "2026-01-01T00:00:01.000Z"
    } as AgentEditProposal;

    expect(latestAgentEditProposalInLane([first, second], "lane")?.id).toBe(
      second.id
    );
    expect(agentEditProposalLaneId(second)).toBe("lane");
  });

  it("uses the current text revision for the first mutation", () => {
    expect(expectedMutationBaseRevision(undefined, "初始大纲")).toBe(
      createShortWorkspaceContentRevision("初始大纲")
    );
  });

  it("chains repeated mutations from the previous proposed revision", () => {
    const existing = proposal("初始大纲", "第一次修改");

    expect(expectedMutationBaseRevision(existing, "尚未应用的页面文本")).toBe(
      existing.proposedRevision
    );
  });

  it("chains repeated mutations for the same physical draft file", () => {
    const existing = proposal("小节正文", "第一次修改");

    expect(expectedMutationBaseRevision(existing, "尚未应用的页面文本")).toBe(
      existing.proposedRevision
    );
  });

  it("classifies a proposal against its unchanged base as ready", () => {
    const edit = proposal("原文", "智能体修改稿");

    expect(classifyAgentEditAcceptance(edit, "原文")).toBe("ready");
  });

  it("recognizes a proposal that is already present in the document", () => {
    const edit = proposal("原文", "智能体修改稿");

    expect(classifyAgentEditAcceptance(edit, "智能体修改稿")).toBe(
      "already-applied"
    );
  });

  it("reports a conflict when the user changed the proposal base", () => {
    const edit = proposal("原文", "智能体修改稿");

    expect(classifyAgentEditAcceptance(edit, "用户的新修改")).toBe("conflict");
  });

  it("rejects proposals whose proposed text was not retained", () => {
    const edit = proposal("原文", undefined);

    expect(classifyAgentEditAcceptance(edit, "原文")).toBe(
      "missing-proposed-text"
    );
  });

  it("treats a targeted mutation as the complete physical file content", () => {
    const resolved = resolveAgentEditorMutationText("第二节旧正文。", {
      stageId: "draft",
      text: "第二节的新正文。",
      mutationTarget: {
        kind: "expert-draft-file",
        documentId: "section-2-body",
        sectionId: "section-2",
        fileKind: "body"
      }
    });
    expect(resolved).toEqual({ text: "第二节的新正文。" });
  });

  it("refuses a draft-file target outside the draft stage", () => {
    const resolved = resolveAgentEditorMutationText("旧正文", {
      stageId: "outline",
      text: "新正文",
      mutationTarget: {
        kind: "expert-draft-file",
        documentId: "section-1-body",
        sectionId: "section-1",
        fileKind: "body"
      }
    });
    expect(resolved).toEqual({
      error: "正文文件修改只能应用到正文目录。"
    });
  });

  it("accepts character-file targets on the character_design stage", () => {
    const resolved = resolveAgentEditorMutationText("", {
      stageId: "character_design",
      text: "# 人物一览\n\n| 序号 | 人物 |\n| --- | --- |\n| 1 | 沈知微 |",
      mutationTarget: {
        kind: "character-file",
        documentId: "character_design"
      }
    });
    expect(resolved).toEqual({
      text: "# 人物一览\n\n| 序号 | 人物 |\n| --- | --- |\n| 1 | 沈知微 |"
    });
  });

  it("accepts provisional character entry writes on character_design", () => {
    const resolved = resolveAgentEditorMutationText("", {
      stageId: "character_design",
      text: "沈知微是穿越恶毒继姐。",
      mutationTarget: {
        kind: "character-file",
        documentId: "character_tmp_1",
        itemId: "character_tmp_1"
      }
    });
    expect(resolved).toEqual({ text: "沈知微是穿越恶毒继姐。" });
  });

  it("refuses character-file targets outside character_design", () => {
    const resolved = resolveAgentEditorMutationText("旧设定", {
      stageId: "draft",
      text: "新设定",
      mutationTarget: {
        kind: "character-file",
        documentId: "character_design"
      }
    });
    expect(resolved).toEqual({
      error: "人物文件修改只能应用到人物设计阶段。"
    });
  });
});
