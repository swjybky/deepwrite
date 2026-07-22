import {
  createShortWorkspaceContentRevision,
  parseExpertDraftMarkdown,
  serializeExpertDraftMarkdown
} from "@deepwrite/contracts";
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
  it("builds a stable proposal id from the run and target stage", () => {
    expect(agentEditProposalId("run-1", "book-1", "outline")).toBe(
      "run-1:book-1:outline"
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

  it("keeps targeted section mutations on the original full-document revision", () => {
    const existing = proposal("完整正文", "合并第一项分节修改后的正文");

    expect(
      expectedMutationBaseRevision(existing, "尚未应用的页面文本", true)
    ).toBe(existing.baseRevision);
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

  it("merges a targeted section field into the complete local draft", () => {
    const original = serializeExpertDraftMarkdown({
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: "第一节保持不变。",
          characterState: "旧状态一"
        },
        {
          id: "section-2",
          title: "第二节",
          wordCountRequirement: "1200 字",
          body: "第二节旧正文。",
          characterState: "旧状态二"
        },
        {
          id: "section-3",
          title: "第三节",
          wordCountRequirement: "1500 字",
          body: "第三节保持不变。",
          characterState: "旧状态三"
        }
      ]
    });

    const resolved = resolveAgentEditorMutationText(original, {
      stageId: "draft",
      text: "第二节的新正文。",
      mutationTarget: {
        kind: "expert-draft-section",
        sectionId: "section-2",
        field: "body"
      }
    });
    expect(resolved).not.toHaveProperty("error");
    if (!("text" in resolved)) throw new Error("Expected resolved text.");
    const draft = parseExpertDraftMarkdown(resolved.text);
    expect(draft.sections.map((section) => section.body)).toEqual([
      "第一节保持不变。",
      "第二节的新正文。",
      "第三节保持不变。"
    ]);
    expect(draft.sections[1]?.characterState).toBe("旧状态二");
  });

  it("refuses a targeted mutation when its section no longer exists", () => {
    const resolved = resolveAgentEditorMutationText("## 第一节\n\n正文", {
      stageId: "draft",
      text: "新正文",
      mutationTarget: {
        kind: "expert-draft-section",
        sectionId: "section-9",
        field: "body"
      }
    });
    expect(resolved).toEqual({
      error: "正文小节 section-9 已不存在，本次修改未应用。"
    });
  });
});
