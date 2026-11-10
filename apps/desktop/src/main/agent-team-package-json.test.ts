import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import {
  AGENT_TEAM_CONFIG_MAX_BYTES,
  createAgentTeamPackageJson,
  readAgentTeamPackageJson
} from "./agent-team-package-json";

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function shortTeam(): AgentTeamProfile {
  const settings = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
  settings.teams[0]!.subagents.push({
    id: "reviewer",
    name: "审稿员",
    description: "检查稿件",
    systemPrompt: "检查完整稿件。",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit"
  });
  return {
    id: "team_json_source",
    name: "JSON 团队",
    workspaceType: "short",
    settings
  };
}

describe("agent team JSON files", () => {
  it("round-trips a readable export manifest, including UTF-8 BOMs", () => {
    const team = shortTeam();
    const data = createAgentTeamPackageJson(
      team,
      new Date("2026-10-12T08:00:00.000Z")
    );
    expect(JSON.parse(data.toString("utf8"))).toMatchObject({
      format: "deepwrite-agent-team",
      version: 1,
      team
    });
    expect(readAgentTeamPackageJson(data)).toEqual(team);
    expect(
      readAgentTeamPackageJson(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), data])
      )
    ).toEqual(team);
  });

  it.each([
    DEFAULT_AGENT_TEAM_SETTINGS,
    DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
    DEFAULT_LONG_AGENT_TEAM_SETTINGS
  ])(
    "imports $workspaceType profiles with or without a source id",
    (settings) => {
      const team = {
        name: "手写团队",
        workspaceType: settings.workspaceType,
        settings
      };
      expect(readAgentTeamPackageJson(json(team))).toMatchObject(team);
      expect(
        readAgentTeamPackageJson(json({ ...team, id: "team_source" }))
      ).toEqual({ ...team, id: "team_source" });
    }
  );

  it.each([
    DEFAULT_AGENT_TEAM_SETTINGS,
    DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
    DEFAULT_LONG_AGENT_TEAM_SETTINGS
  ])("imports $workspaceType settings using the file name", (settings) => {
    expect(readAgentTeamPackageJson(json(settings), "本地团队")).toMatchObject({
      name: "本地团队",
      workspaceType: settings.workspaceType,
      settings
    });
  });

  it("fills older optional subagent fields from the existing contract defaults", () => {
    const team = shortTeam();
    const subagent = team.settings.teams[0]!.subagents[0]!;
    const {
      agentMode: _agentMode,
      modelMode: _modelMode,
      ...legacy
    } = subagent;
    const raw = {
      ...team,
      settings: {
        workspaceType: "short",
        teams: [{ parentAgentId: "short", subagents: [legacy] }]
      }
    };
    const imported = readAgentTeamPackageJson(json(raw));
    expect(imported.settings.parallelSubagents).toBe(false);
    expect(imported.settings.teams[0]!.subagents[0]).toEqual(subagent);
  });

  it("rejects malformed JSON, invalid encoding, empty and oversized files", () => {
    expect(() => readAgentTeamPackageJson(Buffer.from("{broken"))).toThrow(
      "有效 JSON"
    );
    expect(() => readAgentTeamPackageJson(Buffer.from([0xff, 0xfe]))).toThrow(
      "UTF-8"
    );
    expect(() => readAgentTeamPackageJson(Buffer.alloc(0))).toThrow("4 MB");
    expect(() =>
      readAgentTeamPackageJson(Buffer.alloc(AGENT_TEAM_CONFIG_MAX_BYTES + 1))
    ).toThrow("4 MB");
  });

  it("reports an invalid field and rejects mismatched writing types and duplicate subagents", () => {
    const team = shortTeam();
    expect(() => readAgentTeamPackageJson(json({ ...team, name: "" }))).toThrow(
      "name"
    );
    expect(() =>
      readAgentTeamPackageJson(json({ ...team, workspaceType: "long" }))
    ).toThrow("settings.workspaceType");
    team.settings.teams[0]!.subagents.push(
      team.settings.teams[0]!.subagents[0]!
    );
    expect(() => readAgentTeamPackageJson(json(team))).toThrow(
      "subagents.1.id"
    );
  });

  it("does not fall back to a raw team when a manifest format or version is invalid", () => {
    const manifest = JSON.parse(
      createAgentTeamPackageJson(shortTeam()).toString("utf8")
    );
    for (const version of [2, 99]) {
      expect(() =>
        readAgentTeamPackageJson(json({ ...manifest, version }))
      ).toThrow("version");
    }
    expect(() =>
      readAgentTeamPackageJson(json({ ...manifest, format: "unknown-format" }))
    ).toThrow("format");
    for (const value of [null, [], {}, "team"]) {
      expect(() => readAgentTeamPackageJson(json(value))).toThrow();
    }
  });
});
