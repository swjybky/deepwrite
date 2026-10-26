import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";

function proposal(patch: Partial<AgentEditProposal> = {}): AgentEditProposal {
  return {
    id: "proposal_one",
    runId: "run_one",
    workspaceId: "short_book",
    stageId: "draft",
    documentId: "document_one",
    title: "第一节",
    summary: "校对第一节",
    status: "pending",
    approvalMode: "request-approval",
    baseRevision: "v1:3:00000001",
    proposedRevision: "v1:3:00000002",
    proposedText: "校对稿",
    toolCallIds: ["tool_one"],
    additions: 1,
    deletions: 1,
    hunks: [],
    createdAt: "2026-10-19T01:00:00.000Z",
    updatedAt: "2026-10-19T01:00:00.000Z",
    ...patch
  };
}

async function render(
  value: AgentEditProposal,
  messageStatus: "streaming" | "completed" = "completed"
): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(AgentEditProposalCard, {
        proposal: value,
        messageStatus,
        allowLiveEditReview: true
      })
  });
  app.use(createPinia());
  return await renderToString(app);
}

const staleBase = {
  detectedAt: "2026-10-19T01:00:05.000Z",
  currentRevision: "v1:9:00000003"
};

describe("AgentEditProposalCard after the user edited its target", () => {
  it("asks to keep the user's version or overwrite it, even mid-run", async () => {
    const html = await render(proposal({ staleBase }), "streaming");
    expect(html).toContain("你修改过");
    expect(html).toContain("智能体读取后你修改过这篇");
    expect(html).toContain("保留我的");
    expect(html).toContain("用智能体版本覆盖");
    expect(html).not.toContain("接受并保存");
  });

  it("explains long-form overwrites without promising an undo", async () => {
    const html = await render(
      proposal({
        stageId: "long-draft",
        longDraftTarget: {
          bookId: "longbook_one",
          batch: {
            updatedAt: "2026-10-19T01:00:00.000Z",
            operations: [],
            documentWrites: []
          },
          file: {
            chapterCardId: "chapter_one",
            chapterTitle: "第一章",
            fileId: "file_body",
            filePath: "chapters/0001/正文.md",
            operation: "edit",
            beforeText: "初稿",
            afterText: "校对稿"
          }
        },
        staleBase: {
          detectedAt: staleBase.detectedAt,
          currentSha256ByFileId: { file_body: "b".repeat(64) }
        }
      })
    );
    expect(html).toContain("智能体读取后这份内容已被修改");
    expect(html).not.toContain("之后可以撤销");
    expect(html).toContain("用智能体版本覆盖");
  });

  it("keeps the ordinary review wording for an untouched target", async () => {
    const html = await render(proposal());
    expect(html).not.toContain("你修改过");
    expect(html).toContain("拒绝");
  });
});
