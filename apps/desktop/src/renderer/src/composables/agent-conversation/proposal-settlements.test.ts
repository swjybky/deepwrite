import { describe, expect, it } from "vitest";
import type { AgentEditProposal, ChatMessage } from "../../types/conversation";
import { collectProposalSettlements } from "./proposal-settlements";

function proposal(
  id: string,
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id,
    runId: "run_1",
    workspaceId: "short_story_1",
    stageId: "draft",
    documentId: `doc_${id}`,
    title: `文档 ${id}`,
    summary: `修改 ${id}`,
    status: "accepted",
    toolCallIds: [`tool_${id}`],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt: "2026-10-12T01:00:10.000Z",
    updatedAt: "2026-10-12T01:00:20.000Z",
    ...overrides
  };
}

function user(createdAt: string): ChatMessage {
  return { id: `user_${createdAt}`, role: "user", content: "继续", createdAt };
}

function assistant(proposals: AgentEditProposal[]): ChatMessage {
  return {
    id: `assistant_${proposals[0]?.id ?? "empty"}`,
    role: "assistant",
    content: "已提交",
    createdAt: "2026-10-12T01:00:05.000Z",
    runId: "run_1",
    status: "completed",
    editProposals: proposals
  };
}

describe("collectProposalSettlements", () => {
  it("reports every final outcome settled after the previous user turn", () => {
    const settlements = collectProposalSettlements([
      user("2026-10-12T00:00:00.000Z"),
      assistant([
        proposal("old", { updatedAt: "2026-10-12T00:30:00.000Z" }),
        proposal("restored", {
          updatedAt: "2026-10-12T00:30:00.000Z",
          discardState: {
            status: "discarded",
            message: "已恢复",
            updatedAt: "2026-10-12T01:10:00.000Z"
          }
        })
      ]),
      user("2026-10-12T01:00:00.000Z"),
      assistant([
        proposal("saved"),
        proposal("rejected", {
          status: "rejected",
          statusMessage: "已拒绝，原文未改变"
        }),
        proposal("conflict", {
          status: "conflict",
          statusMessage: "  文件已被其他修改更新  "
        }),
        proposal("failed", { status: "error", statusMessage: "保存超时" }),
        proposal("same", { title: "第一章", summary: "第一章" }),
        proposal("library", {
          title: "去 AI 味检查",
          summary: "已生成技能条目「去 AI 味检查」的修改变更，等待用户审阅。"
        })
      ])
    ]);

    expect(settlements).toEqual({
      items: [
        {
          title: "文档 restored",
          summary: "修改 restored",
          status: "reverted"
        },
        { title: "文档 saved", summary: "修改 saved", status: "saved" },
        {
          title: "文档 rejected",
          summary: "修改 rejected",
          status: "rejected"
        },
        {
          title: "文档 conflict",
          summary: "修改 conflict",
          status: "conflict",
          detail: "文件已被其他修改更新"
        },
        {
          title: "文档 failed",
          summary: "修改 failed",
          status: "failed",
          detail: "保存超时"
        },
        { title: "第一章", status: "saved" },
        {
          title: "去 AI 味检查",
          summary: "已生成技能条目「去 AI 味检查」的修改变更",
          status: "saved"
        }
      ]
    });
  });

  it("tells the agent how the user settled an edit made during its run", () => {
    const staleBase = (resolution: "kept-user" | "overwrote") => ({
      detectedAt: "2026-10-12T01:00:15.000Z",
      currentRevision: "v1:3:abcdef01",
      resolution
    });
    expect(
      collectProposalSettlements([
        user("2026-10-12T01:00:00.000Z"),
        assistant([
          proposal("kept", {
            status: "rejected",
            staleBase: staleBase("kept-user")
          }),
          proposal("overwrote", { staleBase: staleBase("overwrote") })
        ])
      ])?.items
    ).toEqual([
      {
        title: "文档 kept",
        summary: "修改 kept",
        status: "rejected",
        detail: "用户在你修改期间编辑了该文档，选择保留自己的版本。"
      },
      {
        title: "文档 overwrote",
        summary: "修改 overwrote",
        status: "saved",
        detail: "用户在你修改期间编辑过该文档，确认用你的版本覆盖。"
      }
    ]);
  });

  it("reports nothing for undecided proposals or a turn without writes", () => {
    expect(
      collectProposalSettlements([
        user("2026-10-12T01:00:00.000Z"),
        assistant([
          proposal("pending", { status: "pending" }),
          proposal("accepting", { status: "accepting" })
        ])
      ])
    ).toBeUndefined();
    expect(
      collectProposalSettlements([user("2026-10-12T01:00:00.000Z")])
    ).toBeUndefined();
  });

  it("caps the listed items and counts the rest", () => {
    const proposals = Array.from({ length: 45 }, (_, index) =>
      proposal(`p${index}`, { title: "  ", summary: "" })
    );
    const settlements = collectProposalSettlements([
      user("2026-10-12T01:00:00.000Z"),
      assistant(proposals)
    ]);
    expect(settlements?.items).toHaveLength(40);
    expect(settlements?.items[0]).toEqual({
      title: "未命名修改",
      status: "saved"
    });
    expect(settlements?.omittedCount).toBe(5);
  });
});
