import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import {
  agentEditProposalId,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision,
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
});
