import { describe, expect, it } from "vitest";
import { externalToolUsage } from "./tool-usage";
import type { AgentToolTrace, ChatMessage } from "../../types/conversation";

const call = (
  id: string,
  status: AgentToolTrace["status"],
  extra = {}
): AgentToolTrace => ({
  id,
  name: "read",
  args: {},
  requestedAt: "2026-11-14T00:00:00.000Z",
  completedAt: "2026-11-14T00:00:00.100Z",
  status,
  ...extra
});

describe("external tool usage", () => {
  it("counts trace results, deduplicates calls and includes child calls without trusting prose", () => {
    const result = externalToolUsage([
      {
        content: "成功999次",
        toolCalls: [
          call("a", "completed"),
          call("b", "completed", { isError: true }),
          call("pending", "running", { completedAt: undefined })
        ],
        subagentRuns: [
          {
            toolCalls: [
              call("a", "completed"),
              call("child", "error", { name: "edit" })
            ]
          }
        ]
      }
    ] as ChatMessage[]);
    expect(result.toolUsage).toMatchObject({
      total: 4,
      succeeded: 1,
      failed: 2,
      pending: 1,
      durationMs: 300
    });
    expect(result.toolUsage.byTool).toEqual([
      {
        name: "edit",
        total: 1,
        succeeded: 0,
        directSucceeded: 0,
        normalizedSucceeded: 0,
        failed: 1,
        pending: 0,
        durationMs: 100
      },
      {
        name: "read",
        total: 3,
        succeeded: 1,
        directSucceeded: 1,
        normalizedSucceeded: 0,
        failed: 1,
        pending: 1,
        durationMs: 200
      }
    ]);
  });
  it("counts empty search results as success", () => {
    expect(
      externalToolUsage([
        {
          toolCalls: [
            call("search", "completed", {
              name: "search",
              resultSummary: "0 hits"
            })
          ]
        }
      ] as ChatMessage[]).toolUsage.succeeded
    ).toBe(1);
  });
});

it("separates normalized successes from direct success and failures", () => {
  const stats = externalToolUsage([
    {
      toolCalls: [
        call("normal", "completed"),
        call("fixed", "completed", {
          resultSummary: "【参数归一化】default head"
        }),
        call("bad", "error", { resultSummary: "【参数归一化】failed" })
      ]
    }
  ] as ChatMessage[]).toolUsage;
  expect(stats).toMatchObject({
    total: 3,
    succeeded: 2,
    directSucceeded: 1,
    normalizedSucceeded: 1,
    failed: 1
  });
});

it("does not treat arbitrary other tool text as normalization", () => {
  expect(
    externalToolUsage([
      {
        toolCalls: [
          call("skill", "completed", {
            name: "load_skill",
            resultSummary: "【参数归一化】user content"
          })
        ]
      }
    ] as ChatMessage[]).toolUsage
  ).toMatchObject({ directSucceeded: 1, normalizedSucceeded: 0 });
});
