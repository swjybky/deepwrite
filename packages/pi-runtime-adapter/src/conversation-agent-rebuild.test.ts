import { describe, expect, it } from "vitest";
import {
  cacheConversationAgent,
  selectConversationAgentForRun
} from "./conversation-agent-rebuild";

function cachedAgent(isStreaming = false) {
  return { state: { isStreaming } };
}

describe("conversation agent rebuild", () => {
  it("permanently removes an idle cached branch before rebuilding it", () => {
    const discarded = cachedAgent();
    const agents = new Map([["session:agent", discarded]]);

    expect(
      selectConversationAgentForRun(agents, "session:agent", "replace")
    ).toBeUndefined();
    expect(agents.has("session:agent")).toBe(false);

    const replacement = cachedAgent();
    cacheConversationAgent(agents, "session:agent", replacement);
    expect(agents.get("session:agent")).toBe(replacement);
  });

  it("reuses normal idle turns and refuses to replace a running agent", () => {
    const idle = cachedAgent();
    const agents = new Map([
      ["idle", idle],
      ["running", cachedAgent(true)]
    ]);

    expect(selectConversationAgentForRun(agents, "idle", undefined)).toBe(idle);
    expect(() =>
      selectConversationAgentForRun(agents, "running", "replace")
    ).toThrow("already running");
    expect(agents.has("running")).toBe(true);
  });
});

it("reuses the domain conversation after changing library focus", async () => {
  const { conversationAgentKey } = await import("./conversation-agent-rebuild");
  const { materialWorkspace, profile } =
    await import("./library-agent-tools/test-fixtures");
  const input = {
    runId: "run",
    sessionId: "session",
    prompt: "manage",
    libraryAgentProfile: profile("material"),
    workspaceContext: { libraryWorkspace: materialWorkspace() }
  };
  const first = conversationAgentKey(input);
  const second = conversationAgentKey({
    ...input,
    workspaceContext: {
      libraryWorkspace: materialWorkspace({ libraryId: "another" })
    }
  });
  expect(first).toBe("session:library:material");
  expect(second).toBe(first);
});
