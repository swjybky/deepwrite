import { expect, it } from "vitest";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  assistant,
  manager,
  policy,
  user
} from "./kernel/context/context.test-support";
import { WORKSPACE_TOOL_COMPACTORS } from "./workspace-context-policy";

it("prunes old search snippets and combined document bodies while retaining business references", async () => {
  const request = assistant();
  request.content = [
    {
      type: "toolCall",
      id: "search-old",
      name: "search",
      arguments: { query: "灯塔" }
    },
    {
      type: "toolCall",
      id: "commit-old",
      name: "propose_continuity_commit",
      arguments: {
        chapter_card_ids: ["chapter_one"],
        summary: "记录状态",
        documents: {
          chapter_end_state: "状态".repeat(8000),
          handoff: "交接".repeat(8000),
          characters: [
            {
              character_id: "character_one",
              current_state: "现状".repeat(8000),
              history: "轨迹".repeat(8000)
            }
          ]
        }
      }
    }
  ];
  const results: ToolResultMessage[] = [
    {
      role: "toolResult",
      toolCallId: "search-old",
      toolName: "search",
      content: [
        {
          type: "text",
          text: "检索灯塔，命中 1 条。\n" + "长检索片段".repeat(8000)
        }
      ],
      isError: false,
      timestamp: 2
    },
    {
      role: "toolResult",
      toolCallId: "commit-old",
      toolName: "propose_continuity_commit",
      content: [{ type: "text", text: "已形成合并提案。" }],
      isError: false,
      timestamp: 3
    }
  ];
  const { guard, agent } = manager(
    [user("归档"), request, ...results, assistant()],
    {
      policy: {
        ...policy,
        task: "long",
        toolCompactors: WORKSPACE_TOOL_COMPACTORS
      }
    }
  );
  const incoming = user("继续", 4);
  guard.noteRunStart(incoming, incoming.content);
  await guard.beforeRun(incoming);
  const serialized = JSON.stringify(agent.state.messages);
  expect(serialized).not.toContain("长检索片段");
  expect(serialized).not.toContain("轨迹".repeat(100));
  expect(serialized).toContain("chapter_one");
  expect(serialized).toContain("character_one");
  expect(serialized).toContain("灯塔");
  expect(serialized).toContain("记录状态");
});
