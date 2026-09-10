import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  AgentTeamPackageManifestSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  BuiltinSubagentSettingsSchema,
  defaultBuiltinSubagentSettings
} from "@deepwrite/contracts";

describe("independent built-in subagent settings", () => {
  it("migrates version four and preserves built-ins across team operations and reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-builtins-"));
    try {
      await mkdir(join(root, "config"));
      const path = join(root, "config", "agent-team-profiles.json");
      await writeFile(
        path,
        JSON.stringify({
          version: 4,
          enabledTeamIds: {},
          teams: [
            {
              id: "original",
              name: "原有团队",
              workspaceType: "short",
              settings: DEFAULT_AGENT_TEAM_SETTINGS
            }
          ]
        })
      );
      const store = new AgentTeamConfigStore(root);
      const migrated = await store.list();
      expect(migrated.builtinSubagents).toEqual(
        defaultBuiltinSubagentSettings()
      );
      expect(JSON.parse(await readFile(path, "utf8")).version).toBe(5);
      const settings = defaultBuiltinSubagentSettings();
      settings.skill.enabled = false;
      settings.material.description = "用户要求记录素材时调用";
      await store.saveBuiltins(settings);
      const added = await store.create({
        name: "另一个团队",
        workspaceType: "script"
      });
      const addedTeam = added.teams.find((team) => team.name === "另一个团队")!;
      await store.setEnabled({ teamId: addedTeam.id, enabled: true });
      const profile = await store.exportProfile({ teamId: addedTeam.id });
      const archive = AgentTeamPackageManifestSchema.parse({
        format: "deepwrite-agent-team",
        version: 1,
        exportedAt: "2026-01-01T00:00:00.000Z",
        team: profile
      });
      expect(JSON.stringify(archive)).not.toContain("builtinSubagents");
      await store.installProfile(profile);
      await store.setEnabled({ teamId: addedTeam.id, enabled: false });
      await store.delete({ teamId: addedTeam.id });
      const reloaded = await new AgentTeamConfigStore(root).list();
      expect(reloaded.builtinSubagents).toEqual(settings);
      expect(reloaded.teams.some((team) => team.id === "original")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("accepts only descriptions and enabled states for the two fixed domains", () => {
    const settings = defaultBuiltinSubagentSettings();
    expect(
      BuiltinSubagentSettingsSchema.safeParse({
        ...settings,
        skill: { ...settings.skill, tools: ["write"] }
      }).success
    ).toBe(false);
    expect(
      BuiltinSubagentSettingsSchema.safeParse({
        ...settings,
        skill: { ...settings.skill, description: " " }
      }).success
    ).toBe(false);
  });
});
