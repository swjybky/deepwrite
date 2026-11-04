import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  type BookTemplateDraft
} from "@deepwrite/contracts";
import { bookTemplateReferenceError } from "./bookTemplateReferences";

const configuration = (linkedAgentTeamIds?: string[]): BookTemplateDraft => ({
  name: "模板",
  workspaceType: "short",
  genre: "其他",
  characterFormat: "text",
  defaultPlotStageIds: ["outline"],
  linkedMaterialIdsByKind: {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  },
  linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
  ...(linkedAgentTeamIds ? { linkedAgentTeamIds } : {})
});
const catalog = {
  creativePlotStages: [
    { id: "outline", title: "大纲", description: "大纲", enabled: true }
  ],
  materials: [],
  skills: []
};
const teams = {
  teams: [
    {
      id: "team-short",
      name: "短篇",
      workspaceType: "short" as const,
      settings: DEFAULT_AGENT_TEAM_SETTINGS
    },
    {
      id: "team-long",
      name: "长篇",
      workspaceType: "long" as const,
      settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
    }
  ]
};

describe("bookTemplateReferenceError with agent teams", () => {
  it("accepts a template without teams and one with valid teams", () => {
    expect(
      bookTemplateReferenceError(configuration(), catalog, teams)
    ).toBeNull();
    expect(
      bookTemplateReferenceError(configuration(["team-short"]), catalog, teams)
    ).toBeNull();
  });

  it("flags a deleted team and a team of another writing type", () => {
    for (const ids of [["deleted"], ["team-long"]]) {
      expect(
        bookTemplateReferenceError(configuration(ids), catalog, teams)
      ).toContain("智能体团队");
    }
  });

  it("skips the team check until the team catalog has loaded", () => {
    expect(
      bookTemplateReferenceError(configuration(["team-short"]), catalog, null)
    ).toBeNull();
  });
});
