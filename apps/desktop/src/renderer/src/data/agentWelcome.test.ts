import { describe, expect, it } from "vitest";
import { SHORT_WORKSPACE_AGENT_IDS } from "@deepwrite/contracts";
import {
  DEFAULT_AGENT_WELCOME,
  SHORT_AGENT_WELCOME_CONTENT,
  resolveAgentWelcome
} from "./agentWelcome";

describe("agent welcome content", () => {
  it("provides an independent welcome and three common questions for every short agent", () => {
    expect(Object.keys(SHORT_AGENT_WELCOME_CONTENT)).toEqual([...SHORT_WORKSPACE_AGENT_IDS]);

    for (const agentId of SHORT_WORKSPACE_AGENT_IDS) {
      const welcome = resolveAgentWelcome(agentId);
      expect(welcome.title).toBeTruthy();
      expect(welcome.description).toContain("智能体");
      expect(welcome.questions).toHaveLength(3);
    }

    expect(
      new Set(SHORT_WORKSPACE_AGENT_IDS.map((agentId) => resolveAgentWelcome(agentId).title)).size
    ).toBe(SHORT_WORKSPACE_AGENT_IDS.length);
  });

  it("falls back to the general welcome outside a short workspace", () => {
    expect(resolveAgentWelcome(undefined)).toBe(DEFAULT_AGENT_WELCOME);
  });
});
