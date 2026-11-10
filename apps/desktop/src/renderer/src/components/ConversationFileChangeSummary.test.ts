import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import type { ApprovalCardItem } from "./conversationToolPresentation";
import ConversationFileChangeSummary from "./ConversationFileChangeSummary.vue";

function proposal(
  name: string,
  patch: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  const laneId = `run:book:draft:${name}`;
  return {
    id: laneId,
    laneId,
    generation: 1,
    approvalMode: "request-approval",
    runId: "run",
    workspaceId: "book",
    stageId: "draft",
    documentId: name,
    title: name,
    summary: `修改${name}`,
    status: "pending",
    toolCallIds: ["tool"],
    additions: 3,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: "deletion", text: "旧句子", oldLineNumber: 1 },
          { type: "addition", text: "新句子", newLineNumber: 1 }
        ]
      }
    ],
    createdAt: "2026-10-28T01:00:00.000Z",
    updatedAt: "2026-10-28T01:00:00.000Z",
    ...patch
  };
}

function edit(value: AgentEditProposal, remoteDevice?: string) {
  return {
    id: `edit:${value.id}`,
    type: "edit-proposal",
    createdAt: value.createdAt,
    toolCallIds: value.toolCallIds,
    canDiscard: false,
    proposal: value,
    ...(remoteDevice ? { remoteDevice } : {})
  } satisfies ApprovalCardItem;
}

async function render(approvals: ApprovalCardItem[]): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(ConversationFileChangeSummary, {
        approvals,
        messageStatus: "completed",
        allowLiveEditReview: false,
        longWorkspaceIndex: null
      })
  });
  app.use(createPinia());
  return await renderToString(app);
}

function rowHtml(html: string, key: string): string {
  const start = html.indexOf(`data-file-change-key="${key}"`);
  const end = html.indexOf("data-file-change-key=", start + 1);
  return html.slice(start, end < 0 ? undefined : end);
}

describe("ConversationFileChangeSummary", () => {
  it("stays visible and opens only the rows awaiting review", async () => {
    const html = await render([
      edit(proposal("第三章", { status: "accepted" })),
      edit(proposal("林晚"))
    ]);
    expect(html).toContain("修改了 2 个文件");
    expect(html).toContain("1 项待处理");
    expect(html).toContain("+6");
    const pending = rowHtml(html, "edit:run:book:draft:林晚");
    expect(pending).toContain('aria-expanded="true"');
    expect(pending).toContain("新句子");
    expect(pending).toContain("接受并保存");
    const accepted = rowHtml(html, "edit:run:book:draft:第三章");
    expect(accepted).toContain('aria-expanded="false"');
    expect(accepted).not.toContain("新句子");
    expect(accepted).toContain("跳转文件");
  });

  it("lists a fully saved turn without expanding any diff", async () => {
    const html = await render([
      edit(proposal("第一章", { status: "accepted" })),
      edit(proposal("第二章", { status: "accepted" }))
    ]);
    expect(html).toContain("已全部保存");
    for (const name of ["第一章", "第二章"]) {
      expect(rowHtml(html, `edit:run:book:draft:${name}`)).toContain(
        'aria-expanded="false"'
      );
    }
    expect(html).not.toContain("edit-proposal-footer");
  });

  it("summarizes rejected work without calling the turn saved", async () => {
    const html = await render([
      edit(proposal("第一章", { status: "accepted" })),
      edit(proposal("第二章", { status: "rejected" }))
    ]);
    expect(html).toContain("已保存 1 项，放弃 1 项");
  });

  it("folds long settled lists but never hides pending rows", async () => {
    const settled = Array.from({ length: 10 }, (_, index) =>
      edit(proposal(`第${index + 1}章`, { status: "accepted" }))
    );
    expect(await render(settled)).toContain("还有 4 个文件");
    const withPending = await render([...settled, edit(proposal("第十一章"))]);
    expect(withPending).not.toContain("还有");
    expect(withPending).toContain("第十一章");
  });

  it("counts repeated writes to one file once and offers earlier writes", async () => {
    const first = proposal("第四章", { status: "accepted", additions: 47 });
    const second = proposal("第四章", {
      id: `${first.laneId}:generation:2`,
      generation: 2,
      additions: 12
    });
    const html = await render([edit(first), edit(second)]);
    expect(html).toContain("修改了 1 个文件");
    expect(html).toContain("写入 2 次");
    expect(html).toContain("+59");
    expect(html).toContain("更早的写入（1）");
  });

  it("shows another device's proposals read-only", async () => {
    const html = await render([
      edit(proposal("第五章", { hunks: [] }), "手机")
    ]);
    expect(html).toContain("来自手机");
    expect(html).toContain("在手机上待审核");
    expect(html).not.toContain("接受并保存");
  });

  it("counts changes instead of files when only structure changed", async () => {
    const html = await render([
      edit(
        proposal("第六章", {
          additions: 0,
          deletions: 0,
          hunks: [],
          status: "accepted",
          draftSectionDeletionTarget: { sectionId: "s6", title: "第六章" }
        })
      )
    ]);
    expect(html).toContain("本轮有 1 项修改");
    expect(html).toContain("删除");
    expect(html).not.toContain("file-change-stats");
  });
});
