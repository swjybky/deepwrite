import { describe, expect, it } from "vitest";
import { PiAgentRuntimeAdapter } from "../../adapter";
import {
  buildConversationRun,
  resolveConversationAgent,
  runFauxExtras
} from "../extras.test-support";
import { runtimeConfig } from "../../web-search/test-support";
import { bookImagePreservationRule } from "../../prompts-book-images";
import {
  CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX,
  cachedAgents,
  chatRoleplayTask
} from "./chat.test-support";

describe("roleplay chat agent", () => {
  it("appends the roleplay boundary to the role without app context or tools", () => {
    const agent = resolveConversationAgent(chatRoleplayTask());
    expect(agent.systemPrompt).toBe(
      `你是住在海边的灯塔守望者。\n\n【人物扮演运行边界】\n${CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX}\n${bookImagePreservationRule()}`
    );
    expect(agent.systemPrompt).not.toContain("DeepWrite 软件基础情况");
    expect(agent.tools()).toEqual([]);
  });

  it("stays immersive even if search settings reach the run", () => {
    const run = buildConversationRun(chatRoleplayTask(), {
      webSearch: runtimeConfig()
    });
    expect(run.tools).toEqual([]);
    expect(run.systemPrompt).not.toContain("【联网搜索】");
    expect(run.systemPrompt).not.toContain("web_fetch");
  });

  it("keeps role histories apart and refreshes an edited role on the next turn", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for (const [roleId, systemPrompt, message] of [
      ["character-a", "你是灯塔守望者。", "灯塔你好"],
      ["character-b", "你是山间旅人。", "旅人你好"],
      ["character-a", "你是爱讲故事的灯塔守望者。", "继续讲故事"]
    ] as const) {
      await runFauxExtras(chatRoleplayTask(roleId, systemPrompt), runtime, {
        sessionId: "shared-session",
        runId: `run-${message}`,
        conversation: { message }
      });
    }
    const cache = cachedAgents(runtime);
    const first = cache.get(
      "shared-session:extras:chat-roleplay:character-a"
    )!.state;
    const second = cache.get(
      "shared-session:extras:chat-roleplay:character-b"
    )!.state;
    expect(first.systemPrompt).toContain("你是爱讲故事的灯塔守望者。");
    expect(first.tools).toEqual([]);
    expect(second.tools).toEqual([]);
    expect(
      first.messages.filter((m) => m.role === "user").map((m) => m.content)
    ).toEqual(["灯塔你好", "继续讲故事"]);
    expect(
      second.messages.filter((m) => m.role === "user").map((m) => m.content)
    ).toEqual(["旅人你好"]);
  });
});
