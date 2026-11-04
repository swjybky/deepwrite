import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  AgentTeamCatalogSnapshotSchema,
  type AgentTeamWorkspaceType,
  type AgentTeamCatalogSnapshot
} from "@deepwrite/contracts";
import { resolveAgentTeamModeAvailability } from "./agentTeamModeAvailability";

const member = {
  id: "researcher",
  name: "资料员",
  description: "查找资料",
  systemPrompt: "只整理与任务有关的资料。",
  enabled: true,
  agentMode: "standard" as const,
  modelMode: "inherit" as const
};

function catalogWithMember(
  workspaceType: AgentTeamWorkspaceType
): AgentTeamCatalogSnapshot {
  if (workspaceType === "short") {
    const settings = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
    settings.teams[0]!.subagents = [member];
    return AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { short: "team-short" },
      teams: [
        {
          id: "team-short",
          name: "短篇团队",
          workspaceType,
          settings
        }
      ]
    });
  }
  if (workspaceType === "script") {
    const settings = structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS);
    settings.teams[0]!.subagents = [member];
    return AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { script: "team-script" },
      teams: [
        {
          id: "team-script",
          name: "剧本团队",
          workspaceType,
          settings
        }
      ]
    });
  }
  const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
  settings.teams[0]!.subagents = [member];
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { long: "team-long" },
    teams: [
      {
        id: "team-long",
        name: "长篇团队",
        workspaceType,
        settings
      }
    ]
  });
}

describe("agent team mode availability for bound books", () => {
  const availability = (
    catalog: AgentTeamCatalogSnapshot,
    bookId: string | undefined
  ) =>
    resolveAgentTeamModeAvailability({
      catalog,
      workspaceType: "short",
      parentAgentId: "short",
      bookId,
      loaded: true,
      loading: false,
      loadError: null
    });

  it("uses the enabled team for a book with no binding", () => {
    const catalog = catalogWithMember("short");
    expect(availability(catalog, "book-1")).toEqual(
      availability(catalog, undefined)
    );
  });

  it("names the bound teams when a book has them", () => {
    const catalog = catalogWithMember("short");
    const team = catalog.teams[0]!;
    const result = availability(
      {
        ...catalog,
        enabledTeamIds: {},
        bookBindings: { "book-1": [team.id] }
      },
      "book-1"
    );
    expect(result.available).toBe(true);
    expect(result.description).toContain(team.name);
  });

  it("stays unavailable instead of using the enabled team when bound teams are gone", () => {
    const result = availability(
      {
        ...catalogWithMember("short"),
        bookBindings: { "book-1": ["deleted-team"] }
      },
      "book-1"
    );
    expect(result.available).toBe(false);
    expect(result.description).toContain("绑定的团队");
  });
});

describe("agent team mode availability", () => {
  it("enables team mode only for the current parent agent with an enabled member", () => {
    for (const [workspaceType, parentAgentId] of [
      ["short", "short"],
      ["script", "script"],
      ["long", "long"]
    ] as const) {
      expect(
        resolveAgentTeamModeAvailability({
          catalog: catalogWithMember(workspaceType),
          workspaceType,
          parentAgentId,
          loaded: true,
          loading: false,
          loadError: null
        }).available
      ).toBe(true);
    }
    expect(
      resolveAgentTeamModeAvailability({
        catalog: catalogWithMember("short"),
        workspaceType: "short",
        parentAgentId: "character",
        loaded: true,
        loading: false,
        loadError: null
      })
    ).toMatchObject({ available: false });
  });

  it("disables team mode while loading or after a load failure", () => {
    expect(
      resolveAgentTeamModeAvailability({
        catalog: null,
        workspaceType: "long",
        parentAgentId: "long",
        loaded: false,
        loading: true,
        loadError: null
      }).description
    ).toContain("正在加载");
    expect(
      resolveAgentTeamModeAvailability({
        catalog: null,
        workspaceType: "script",
        parentAgentId: "script",
        loaded: false,
        loading: false,
        loadError: "读取失败"
      }).description
    ).toContain("加载失败");
  });
});
