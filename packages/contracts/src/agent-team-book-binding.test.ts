import { describe, expect, it } from "vitest";
import {
  AgentTeamCatalogSnapshotSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  ShortAgentSubagentDefinitionsSchema,
  activeAgentTeamMembers,
  activeAgentTeams,
  activeAgentTeamsParallel,
  agentTeamBoundBookCount,
  withoutAgentTeamBindings,
  type AgentTeamCatalogSnapshot,
  type ShortAgentSubagentDefinition
} from "./index";

const PARENT = DEFAULT_AGENT_TEAM_SETTINGS.teams[0]!.parentAgentId;

function member(
  overrides: Partial<ShortAgentSubagentDefinition> = {}
): ShortAgentSubagentDefinition {
  return {
    id: "reviewer",
    name: "审稿员",
    description: "审稿",
    systemPrompt: "只审稿。",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit",
    ...overrides
  };
}

function team(
  id: string,
  subagents: ShortAgentSubagentDefinition[],
  parallelSubagents = false
) {
  const settings = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
  settings.teams[0]!.subagents = subagents;
  settings.parallelSubagents = parallelSubagents;
  return { id, name: id, workspaceType: "short" as const, settings };
}

function catalog(
  overrides: Partial<AgentTeamCatalogSnapshot> = {}
): AgentTeamCatalogSnapshot {
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { short: "enabled" },
    teams: [
      team("enabled", [member({ id: "enabled-member", name: "启用成员" })]),
      team("bound-a", [member()]),
      team("bound-b", [member({ id: "editor", name: "编辑" })])
    ],
    ...overrides
  });
}

describe("activeAgentTeams", () => {
  it("uses the enabled team for a book with no binding", () => {
    const active = activeAgentTeams(catalog(), "short", "book-1");
    expect(active.source).toBe("enabled");
    expect(active.teams.map((item) => item.id)).toEqual(["enabled"]);
  });

  it("ignores other books' bindings", () => {
    const active = activeAgentTeams(
      catalog({ bookBindings: { "book-2": ["bound-a"] } }),
      "short",
      "book-1"
    );
    expect(active.teams.map((item) => item.id)).toEqual(["enabled"]);
  });

  it("uses only the bound teams, in binding order, for a bound book", () => {
    const active = activeAgentTeams(
      catalog({ bookBindings: { "book-1": ["bound-b", "bound-a"] } }),
      "short",
      "book-1"
    );
    expect(active.source).toBe("bound");
    expect(active.teams.map((item) => item.id)).toEqual(["bound-b", "bound-a"]);
  });

  it("does not depend on the enabled team once bound", () => {
    const bookBindings = { "book-1": ["bound-a"] };
    const withEnabled = activeAgentTeams(
      catalog({ bookBindings }),
      "short",
      "book-1"
    );
    const withoutEnabled = activeAgentTeams(
      catalog({ bookBindings, enabledTeamIds: {} }),
      "short",
      "book-1"
    );
    expect(withoutEnabled).toEqual(withEnabled);
  });

  it("never falls back to the enabled team when bound teams are gone", () => {
    const active = activeAgentTeams(
      catalog({ bookBindings: { "book-1": ["deleted-team"] } }),
      "short",
      "book-1"
    );
    expect(active).toEqual({ source: "bound", teams: [] });
    expect(activeAgentTeamMembers(active, PARENT)).toEqual([]);
    expect(activeAgentTeamsParallel(active)).toBe(false);
  });

  it("ignores a bound team of another writing type", () => {
    const active = activeAgentTeams(
      catalog({ bookBindings: { "book-1": ["bound-a"] } }),
      "script",
      "book-1"
    );
    expect(active).toEqual({ source: "bound", teams: [] });
  });
});

describe("activeAgentTeamMembers", () => {
  const members = (teams: ReturnType<typeof team>[]) =>
    activeAgentTeamMembers(
      activeAgentTeams(
        catalog({
          teams: [team("enabled", []), ...teams],
          bookBindings: { book: teams.map((item) => item.id) }
        }),
        "short",
        "book"
      ),
      PARENT
    );

  it("returns one team's enabled members unchanged", () => {
    const definition = member();
    const result = activeAgentTeamMembers(
      activeAgentTeams(
        catalog({
          teams: [
            team("enabled", [
              definition,
              member({ id: "off", name: "关闭", enabled: false })
            ])
          ]
        }),
        "short",
        undefined
      ),
      PARENT
    );
    expect(result).toEqual([definition]);
  });

  it("merges the members of every bound team in binding order", () => {
    expect(
      members([
        team("a", [member()]),
        team("b", [member({ id: "editor", name: "编辑" })])
      ]).map((item) => item.id)
    ).toEqual(["reviewer", "editor"]);
  });

  it("keeps one copy of identical members", () => {
    expect(
      members([team("a", [member()]), team("b", [member()])])
    ).toHaveLength(1);
  });

  it("keeps clashing members under unique ids and names a run accepts", () => {
    const result = members([
      team("a", [member()]),
      team("b", [member({ description: "另一种审稿" })]),
      team("c", [member({ description: "第三种审稿" })])
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "reviewer",
      "reviewer-2",
      "reviewer-3"
    ]);
    expect(result.map((item) => item.name)).toEqual([
      "审稿员",
      "审稿员（b）",
      "审稿员（c）"
    ]);
    expect(ShortAgentSubagentDefinitionsSchema.safeParse(result).success).toBe(
      true
    );
  });

  it("gives clashes the same result on every run", () => {
    const teams = [
      team("a", [member()]),
      team("b", [member({ description: "另一种审稿" })])
    ];
    expect(members(teams)).toEqual(members(structuredClone(teams)));
  });
});

describe("activeAgentTeamsParallel", () => {
  const parallel = (a: boolean, b: boolean) =>
    activeAgentTeamsParallel(
      activeAgentTeams(
        catalog({
          teams: [team("a", [], a), team("b", [], b)],
          enabledTeamIds: {},
          bookBindings: { book: ["a", "b"] }
        }),
        "short",
        "book"
      )
    );

  it("requires every bound team to allow it", () => {
    expect(parallel(true, true)).toBe(true);
    expect(parallel(true, false)).toBe(false);
    expect(parallel(false, false)).toBe(false);
  });

  it("follows the enabled team for an unbound book", () => {
    const active = (parallelSubagents: boolean) =>
      activeAgentTeams(
        catalog({ teams: [team("enabled", [], parallelSubagents)] }),
        "short",
        "book"
      );
    expect(activeAgentTeamsParallel(active(true))).toBe(true);
    expect(activeAgentTeamsParallel(active(false))).toBe(false);
  });
});

describe("binding bookkeeping", () => {
  it("counts the books bound to a team", () => {
    const bindings = { one: ["a", "b"], two: ["b"], three: ["c"] };
    expect(agentTeamBoundBookCount(bindings, "b")).toBe(2);
    expect(agentTeamBoundBookCount(undefined, "b")).toBe(0);
  });

  it("removes a deleted team and returns emptied books to the default", () => {
    expect(
      withoutAgentTeamBindings({ one: ["a", "b"], two: ["a"] }, "a")
    ).toEqual({ one: ["b"] });
  });

  it("rejects a snapshot binding with no teams or repeated teams", () => {
    for (const bookBindings of [{ book: [] }, { book: ["a", "a"] }]) {
      expect(
        AgentTeamCatalogSnapshotSchema.safeParse({
          ...catalog(),
          bookBindings
        }).success
      ).toBe(false);
    }
  });
});
