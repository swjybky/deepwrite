import { describe, expect, it } from "vitest";
import type { AgentSubagentRun, ChatMessage } from "../types/conversation";
import {
  subagentProcessingDisplayItems,
  subagentRetryStatus,
  subagentReviewHint,
  subagentStatusLabel
} from "./subagentRunPresentation";

const startedAt = "2026-01-01T00:00:00.000Z";

function run(overrides: Partial<AgentSubagentRun> = {}): AgentSubagentRun {
  return {
    parentToolCallId: "tool_1",
    subagentRunId: "sub_1",
    subagentId: "writer",
    name: "写手小弟",
    task: "请编写第2小节正文",
    status: "running",
    runtime: { provider: "openai", model: "demo", mode: "local-faux" },
    toolCalls: [],
    processingSteps: [],
    startedAt,
    ...overrides
  };
}

describe("subagentRunPresentation", () => {
  it("formats retry labels from the live clock", () => {
    const retrying = run({
      retry: {
        turnId: "turn_1",
        attempt: 2,
        maxAttempts: 4,
        state: "scheduled",
        retryAt: "2026-01-01T00:00:08.000Z"
      }
    });
    expect(
      subagentStatusLabel(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("3s 后重试");
    expect(
      subagentRetryStatus(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("网络波动，3s 后重试（第 1/3 次）");
    expect(
      subagentRetryStatus(
        run({
          retry: {
            turnId: "turn_1",
            attempt: 2,
            maxAttempts: 4,
            state: "trying"
          }
        }),
        Date.parse(startedAt)
      )
    ).toBe("正在重试（第 1/3 次）");
    expect(subagentStatusLabel(run(), Date.parse(startedAt))).toBe(
      "安排任务中"
    );
    expect(
      subagentStatusLabel(
        run({
          processingSteps: [
            {
              id: "think",
              type: "thinking",
              content: "先看开场",
              createdAt: startedAt
            }
          ]
        }),
        Date.parse(startedAt)
      )
    ).toBe("子智能体执行中");
  });

  it("prefers pending review over write-call counts", () => {
    const writing = run({
      toolCalls: [
        {
          id: "write_1",
          name: "write_draft_section",
          args: { section_id: "section-2" },
          status: "completed",
          requestedAt: startedAt
        }
      ]
    });
    const message = {
      editProposals: [
        {
          id: "proposal_1",
          status: "pending",
          toolCallIds: ["write_1"],
          createdAt: startedAt
        }
      ]
    } as ChatMessage;
    expect(subagentReviewHint({} as ChatMessage, writing)).toBe("1 次写入调用");
    expect(subagentReviewHint(message, writing)).toBe("1 项待审阅");
  });

  it("folds thinking and tools until a visible inner response", () => {
    const current = run({
      toolCalls: [
        {
          id: "read_1",
          name: "read_workspace_content",
          args: {},
          status: "completed",
          requestedAt: startedAt,
          resultSummary: "已读取"
        }
      ],
      processingSteps: [
        {
          id: "think-a",
          type: "thinking",
          content: "先读文件",
          createdAt: startedAt
        },
        {
          id: "tool-a",
          type: "tool",
          toolCallId: "read_1",
          createdAt: startedAt
        },
        {
          id: "reply-a",
          type: "response",
          content: "阶段结论",
          createdAt: startedAt
        },
        {
          id: "think-b",
          type: "thinking",
          content: "继续",
          createdAt: startedAt
        }
      ]
    });
    const items = subagentProcessingDisplayItems(current);
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group"
    ]);
    expect(items[0]).toMatchObject({ running: false });
    expect(items[2]).toMatchObject({ type: "work-group", running: true });
  });
  it("keeps unchanged display items as the same objects while a child streams", () => {
    const read = (id: string) => ({
      id,
      name: "read_workspace_content",
      args: {},
      status: "completed" as const,
      requestedAt: startedAt
    });
    const current = run({
      toolCalls: [read("read_1")],
      processingSteps: [
        {
          id: "think-a",
          type: "thinking",
          content: "先读",
          createdAt: startedAt
        },
        {
          id: "tool-a",
          type: "tool",
          toolCallId: "read_1",
          createdAt: startedAt
        },
        {
          id: "reply-a",
          type: "response",
          content: "结论",
          createdAt: startedAt
        },
        {
          id: "think-b",
          type: "thinking",
          content: "继续",
          createdAt: startedAt
        }
      ]
    });
    const first = subagentProcessingDisplayItems(current);

    const latest = current.processingSteps.at(-1);
    if (latest?.type === "thinking") latest.content += "思考";
    const streamed = subagentProcessingDisplayItems(current, first);
    expect(streamed).toHaveLength(3);
    streamed.forEach((item, index) => expect(item).toBe(first[index]));

    current.toolCalls.push(read("read_2"));
    current.processingSteps.push({
      id: "tool-b",
      type: "tool",
      toolCallId: "read_2",
      createdAt: startedAt
    });
    const grown = subagentProcessingDisplayItems(current, streamed);
    expect(grown[0]).toBe(first[0]);
    expect(grown[1]).toBe(first[1]);
    expect(grown[2]).not.toBe(first[2]);
    expect(grown[2]).toMatchObject({ type: "work-group", running: false });

    current.toolCalls.at(-1)!.status = "running";
    const active = subagentProcessingDisplayItems(current, grown);
    expect(active[0]).toBe(grown[0]);
    expect(active[1]).toBe(grown[1]);
    expect(active[2]).not.toBe(grown[2]);
    expect(active[2]).toMatchObject({ type: "work-group", running: true });
  });
});
