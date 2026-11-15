import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsSchema
} from "./index";

describe("long agent team contracts", () => {
  it("defines the single long parent team without widening WorkspaceType", () => {
    const settings = LongAgentTeamSettingsSchema.parse(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS
    );
    expect(settings.workspaceType).toBe("long");
    expect(settings.teams).toHaveLength(1);
    expect(settings.teams[0]!.parentAgentId).toBe("long");
  });

  it("provides disabled writer, recorder and pure-read reviewer templates", () => {
    const members = DEFAULT_LONG_AGENT_TEAM_SETTINGS.teams[0]!.subagents;
    expect(members.map((member) => member.id)).toEqual([
      "chapter_writer",
      "continuity_recorder",
      "continuity_reviewer"
    ]);
    expect(
      members.every(
        (member) => !member.enabled && member.modelMode === "inherit"
      )
    ).toBe(true);
    expect(members[2]!.agentMode).toBe("pure-read");
    expect(members[0]!.systemPrompt).toContain("tail");
    expect(members[1]!.systemPrompt).toContain("documents");
    expect(members[2]!.systemPrompt).toContain("search");
  });

  it("rejects team lists that do not hold exactly the long parent role", () => {
    const extra = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    extra.teams.push(structuredClone(extra.teams[0]!));
    expect(() => LongAgentTeamSettingsSchema.parse(extra)).toThrow();

    const empty = { ...DEFAULT_LONG_AGENT_TEAM_SETTINGS, teams: [] };
    expect(() => LongAgentTeamSettingsSchema.parse(empty)).toThrow();
  });
});
