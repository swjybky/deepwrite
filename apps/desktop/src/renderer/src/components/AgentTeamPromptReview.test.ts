import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type {
  AgentTeamChangeReview,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import Review from "./AgentTeamPromptReview.vue";

const member: ShortAgentSubagentDefinition = {
  id: "editor",
  name: "校对成员",
  description: "核对设定",
  enabled: true,
  agentMode: "pure-read",
  modelMode: "inherit",
  systemPrompt: "原有提示词",
  draw: {
    enabled: true,
    count: 3,
    selection: "auto",
    evaluator: { modelMode: "inherit", prompt: "旧评估提示词" }
  }
};
function render(after?: ShortAgentSubagentDefinition) {
  const review: AgentTeamChangeReview = {
    scope: { bookId: "book", bookType: "short" },
    teamId: "team",
    teamName: "团队",
    baseRevision: "a".repeat(32),
    summary: "调整配置",
    enabledAsDefault: true,
    boundBookCount: 2,
    members: [
      {
        parentAgentId: "short",
        memberId: member.id,
        before: member,
        ...(after ? { after } : {})
      }
    ]
  };
  return renderToString(createSSRApp(Review, { review, requestId: "review" }));
}
describe("team change review", () => {
  it("shows evaluator-only changes even when member prompt and draw count are unchanged", async () => {
    const html = await render({
      ...member,
      draw: {
        ...member.draw!,
        selection: "manual",
        evaluator: {
          modelMode: "custom",
          modelId: "test-evaluator",
          thinkingLevel: "off",
          temperature: 0.7,
          prompt: "新评估提示词"
        }
      }
    });
    for (const text of [
      "旧评估提示词",
      "新评估提示词",
      "test-evaluator",
      "0.7",
      "manual",
      "auto"
    ])
      expect(html).toContain(text);
    expect(html).toContain("2");
  });
  it("shows the original prompt and settings when removing a member", async () => {
    const html = await render();
    expect(html).toContain("删除成员");
    expect(html).toContain("原有提示词");
    expect(html).toContain("旧评估提示词");
  });
});
