import { describe, expect, it } from "vitest";
import { SUBAGENT_AGENT_MODE_LABELS } from "./agentTeamSettingsMeta";

describe("AgentTeamSettingsPanel", () => {
  it("labels all three run modes distinctly", () => {
    const labels = Object.values(SUBAGENT_AGENT_MODE_LABELS);
    expect(Object.keys(SUBAGENT_AGENT_MODE_LABELS)).toEqual([
      "standard",
      "pure-read",
      "pure-bare"
    ]);
    expect(new Set(labels).size).toBe(3);
    expect(
      labels.every((label) => label && !label.startsWith("agentMode"))
    ).toBe(true);
  });
});
