import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACADEMIC_AGENT_TEAM_SETTINGS,
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";

const roots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-agent-team-catalog-"));
  roots.add(root);
  return root;
}

function profileOfType<Type extends AgentTeamProfile["workspaceType"]>(
  snapshot: AgentTeamCatalogSnapshot,
  workspaceType: Type,
  name?: string
): Extract<AgentTeamProfile, { workspaceType: Type }> {
  const team = snapshot.teams.find(
    (candidate) =>
      candidate.workspaceType === workspaceType &&
      (!name || candidate.name === name)
  );
  if (!team || team.workspaceType !== workspaceType)
    throw new Error("缺少测试团队");
  return team as Extract<AgentTeamProfile, { workspaceType: Type }>;
}

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true }))
  );
  roots.clear();
});

describe("AgentTeamConfigStore", () => {
  it("creates five disabled default profiles (including academic and mystery teams) and persists version six", async () => {
    const root = await temporaryRoot();
    const snapshot = await new AgentTeamConfigStore(root).list();

    expect(snapshot.enabledTeamIds).toEqual({});
    expect(snapshot.teams).toHaveLength(5);
    expect(profileOfType(snapshot, "short")).toMatchObject({
      name: "默认短篇团队",
      settings: DEFAULT_AGENT_TEAM_SETTINGS
    });
    expect(profileOfType(snapshot, "script")).toMatchObject({
      name: "默认剧本团队",
      settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
    });
    expect(profileOfType(snapshot, "long")).toMatchObject({
      name: "默认长篇团队",
      settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
    });
    const academicTeam = profileOfType(snapshot, "academic");
    expect(academicTeam).toMatchObject({
      name: "默认学术团队",
      settings: DEFAULT_ACADEMIC_AGENT_TEAM_SETTINGS
    });
    const academicSubagents = academicTeam.settings.teams[0]!.subagents;
    expect(academicSubagents.map((member) => member.id)).toEqual([
      "literature_curator",
      "section_drafter",
      "peer_reviewer",
      "citation_auditor",
      "academic_polisher"
    ]);
    expect(academicSubagents.every((member) => member.enabled === false)).toBe(
      true
    );
    expect(
      academicSubagents.every((member) => member.modelMode === "inherit")
    ).toBe(true);
    expect(profileOfType(snapshot, "mystery")).toMatchObject({
      name: "默认剧本杀团队",
      settings: DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS
    });
    expect(
      JSON.parse(
        await readFile(join(root, "config", "agent-team-profiles.json"), "utf8")
      )
    ).toMatchObject({ version: 6, enabledTeamIds: {} });
  });

  it("smoothly upgrades a version 5 catalog by appending 默认学术团队 and 默认剧本杀团队 without altering existing teams or enabledTeamIds", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config, { recursive: true });
    const v5Payload = {
      version: 5,
      enabledTeamIds: { short: "team_short_existing" },
      teams: [
        {
          id: "team_short_existing",
          name: "我的短篇团",
          workspaceType: "short",
          settings: DEFAULT_AGENT_TEAM_SETTINGS
        },
        {
          id: "team_script_existing",
          name: "我的剧本团",
          workspaceType: "script",
          settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
        },
        {
          id: "team_long_existing",
          name: "我的长篇团",
          workspaceType: "long",
          settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
        }
      ]
    };
    await writeFile(
      join(config, "agent-team-profiles.json"),
      JSON.stringify(v5Payload, null, 2)
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    expect(snapshot.enabledTeamIds).toEqual({ short: "team_short_existing" });
    expect(snapshot.teams.slice(0, 3)).toMatchObject(v5Payload.teams);
    expect(snapshot.teams).toHaveLength(5);
    const academic = profileOfType(snapshot, "academic");
    expect(academic.name).toBe("默认学术团队");
    expect(
      academic.settings.teams[0]!.subagents.every((m) => m.enabled === false)
    ).toBe(true);
    expect(profileOfType(snapshot, "mystery").name).toBe("默认剧本杀团队");
    const disk = JSON.parse(
      await readFile(join(config, "agent-team-profiles.json"), "utf8")
    );
    expect(disk.version).toBe(6);
  });

  it("migrates each legacy type into its own enabled team without deleting sources", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    const short = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
    short.teams[0]!.subagents.push({
      id: "short_helper",
      name: "短篇助手",
      description: "短篇",
      systemPrompt: "短篇",
      enabled: true,
      agentMode: "standard",
      modelMode: "inherit"
    });
    const script = structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS);
    const long = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    await Promise.all([
      writeFile(
        join(config, "agent-teams.json"),
        JSON.stringify({ version: 1, ...short })
      ),
      writeFile(
        join(config, "agent-teams-script.json"),
        JSON.stringify({ version: 1, ...script })
      ),
      writeFile(
        join(config, "long-agent-teams.json"),
        JSON.stringify({ version: 2, ...long })
      )
    ]);

    const snapshot = await new AgentTeamConfigStore(root).list();
    expect(profileOfType(snapshot, "short").settings).toEqual(short);
    expect(profileOfType(snapshot, "script").settings).toEqual(script);
    expect(profileOfType(snapshot, "long").settings).toEqual(long);
    expect(snapshot.enabledTeamIds).toEqual({
      short: profileOfType(snapshot, "short").id,
      script: profileOfType(snapshot, "script").id,
      long: profileOfType(snapshot, "long").id
    });
    await expect(
      readFile(join(config, "agent-teams.json"), "utf8")
    ).resolves.toBeTruthy();
  });

  it("splits a recognizable combined catalog regardless of its version marker", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "agent-team-profiles.json"),
      JSON.stringify({
        version: 17,
        activeTeamId: "team_original",
        teams: [
          {
            id: "team_original",
            name: "默认团队",
            shortSettings: {
              workspaceType: "short",
              teams: [
                "character_design",
                "plot_design",
                "expert_draft_coordinator"
              ].map((parentAgentId) => ({ parentAgentId, subagents: [] }))
            },
            scriptSettings: {
              workspaceType: "script",
              teams: [
                "character_design",
                "plot_design",
                "expert_draft_coordinator"
              ].map((parentAgentId) => ({ parentAgentId, subagents: [] }))
            },
            longSettings: {
              workspaceType: "long",
              teams: [
                "setting",
                "plot_design",
                "draft",
                "continuity_ledger"
              ].map((parentAgentId) => ({
                parentAgentId,
                subagents:
                  parentAgentId === "setting"
                    ? [
                        {
                          id: "legacy_setting_helper",
                          name: "旧版设定助手",
                          description: "迁移旧设定",
                          systemPrompt: "整理设定。",
                          enabled: true
                        }
                      ]
                    : []
              }))
            }
          }
        ]
      })
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    expect(snapshot.teams.map((team) => team.name)).toEqual([
      "默认短篇团队",
      "默认剧本团队",
      "默认长篇团队",
      "默认学术团队",
      "默认剧本杀团队"
    ]);
    expect(snapshot.enabledTeamIds).toEqual({
      short: profileOfType(snapshot, "short").id,
      script: profileOfType(snapshot, "script").id,
      long: profileOfType(snapshot, "long").id
    });
    expect(
      profileOfType(snapshot, "long").settings.teams[0]?.subagents[0]
    ).toMatchObject({
      id: "legacy_setting_helper",
      modelMode: "inherit"
    });
  });

  it("turns a standalone historical payload into a new typed team", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    const short = {
      workspaceType: "short" as const,
      teams: [
        { parentAgentId: "character_design", subagents: [] },
        {
          parentAgentId: "plot_design",
          subagents: [
            {
              id: "legacy_reviewer",
              name: "旧版审阅",
              description: "迁移旧配置",
              systemPrompt: "保留旧版提示词。",
              enabled: true,
              modelMode: "inherit"
            }
          ]
        },
        { parentAgentId: "expert_draft_coordinator", subagents: [] }
      ]
    };
    await writeFile(
      join(config, "agent-team-profiles.json"),
      JSON.stringify({ version: "historical", ...short })
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    const migrated = profileOfType(snapshot, "short");
    expect(migrated.settings).toEqual({
      workspaceType: "short",
      parallelSubagents: false,
      teams: [
        {
          parentAgentId: "short",
          subagents: [expect.objectContaining({ id: "legacy_reviewer" })]
        }
      ]
    });
    expect(snapshot.enabledTeamIds.short).toBe(migrated.id);
    expect(
      JSON.parse(
        await readFile(join(config, "agent-team-profiles.json"), "utf8")
      ).version
    ).toBe(6);
  });

  it("auto-seeds a disabled mystery team when upgrading a v5 three-team catalog without recreating after deletion", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "agent-team-profiles.json"),
      JSON.stringify({
        version: 5,
        enabledTeamIds: { short: "team_short_1" },
        teams: [
          {
            id: "team_short_1",
            name: "默认短篇团队",
            workspaceType: "short",
            settings: DEFAULT_AGENT_TEAM_SETTINGS
          },
          {
            id: "team_script_1",
            name: "默认剧本团队",
            workspaceType: "script",
            settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
          },
          {
            id: "team_long_1",
            name: "默认长篇团队",
            workspaceType: "long",
            settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
          }
        ]
      })
    );

    const store = new AgentTeamConfigStore(root);
    const upgraded = await store.list();
    const mysteryTeam = profileOfType(upgraded, "mystery");
    expect(mysteryTeam.name).toBe("默认剧本杀团队");
    expect(upgraded.enabledTeamIds).toEqual({ short: "team_short_1" });
    expect(await store.resolve("mystery", "mystery")).toEqual([]);

    await store.setEnabled({ teamId: mysteryTeam.id, enabled: true });
    const resolved = await store.resolve("mystery", "mystery");
    expect(resolved).toEqual([]);

    const editedSettings = structuredClone(mysteryTeam.settings);
    editedSettings.teams[0]!.subagents[0]!.enabled = true;
    await store.save({ teamId: mysteryTeam.id, settings: editedSettings });
    const activeMembers = await store.resolve("mystery", "mystery");
    expect(activeMembers.map((m) => m.id)).toContain("role_script_writer");

    await store.setEnabled({ teamId: mysteryTeam.id, enabled: false });
    const afterDelete = await store.delete({ teamId: mysteryTeam.id });
    expect(afterDelete.teams.some((t) => t.workspaceType === "mystery")).toBe(
      false
    );
    const reloaded = await store.list();
    expect(reloaded.teams.some((t) => t.workspaceType === "mystery")).toBe(
      false
    );
  });

  it("accepts recognizable separate legacy files with unknown versions", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "agent-teams.json"),
      JSON.stringify({ version: 99, ...DEFAULT_AGENT_TEAM_SETTINGS })
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    const migrated = profileOfType(snapshot, "short");
    expect(migrated.settings).toEqual(DEFAULT_AGENT_TEAM_SETTINGS);
    expect(snapshot.enabledTeamIds.short).toBe(migrated.id);
  });

  it("migrates historical long parent-agent ids into a current long team", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "long-agent-teams.json"),
      JSON.stringify({
        version: 1,
        workspaceType: "long",
        teams: [
          {
            parentAgentId: "setting",
            subagents: [
              {
                id: "setting_helper",
                name: "设定助手",
                description: "整理设定",
                systemPrompt: "整理长篇设定。",
                enabled: true,
                modelMode: "inherit"
              }
            ]
          },
          { parentAgentId: "plot_design", subagents: [] },
          { parentAgentId: "draft", subagents: [] },
          { parentAgentId: "continuity_ledger", subagents: [] }
        ]
      })
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    const migrated = profileOfType(snapshot, "long");
    expect(migrated.settings.teams).toEqual([
      {
        parentAgentId: "long",
        subagents: [expect.objectContaining({ id: "setting_helper" })]
      }
    ]);
    expect(snapshot.enabledTeamIds.long).toBe(migrated.id);
  });

  it("isolates profiles and allows one enabled team per type or none", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const created = await store.create({
      name: "审稿团队",
      workspaceType: "short"
    });
    const second = profileOfType(created, "short", "审稿团队");
    const settings = structuredClone(second.settings);
    settings.teams[0]!.subagents.push({
      id: "reviewer",
      name: "审阅",
      description: "检查剧情",
      systemPrompt: "审阅剧情",
      enabled: true,
      agentMode: "standard",
      modelMode: "inherit"
    });
    await store.save({ teamId: second.id, settings });

    expect(await store.resolve("short", "short")).toEqual([]);
    const enabled = await store.setEnabled({
      teamId: second.id,
      enabled: true
    });
    expect(enabled.enabledTeamIds.short).toBe(second.id);
    expect(await store.resolve("short", "short")).toEqual([
      expect.objectContaining({ id: "reviewer" })
    ]);
    await expect(store.delete({ teamId: second.id })).rejects.toThrow(
      "不能删除"
    );
    const disabled = await store.setEnabled({
      teamId: second.id,
      enabled: false
    });
    expect(disabled.enabledTeamIds.short).toBeUndefined();
    await expect(store.delete({ teamId: second.id })).resolves.toBeTruthy();
  });

  it("reads the parallel switch from the enabled team of each type only", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const created = await store.create({
      name: "并行团队",
      workspaceType: "long"
    });
    const team = profileOfType(created, "long", "并行团队");
    await store.save({
      teamId: team.id,
      settings: { ...structuredClone(team.settings), parallelSubagents: true }
    });

    expect(await store.parallelSubagentsEnabled("long")).toBe(false);
    await store.setEnabled({ teamId: team.id, enabled: true });
    expect(await store.parallelSubagentsEnabled("long")).toBe(true);
    expect(await store.parallelSubagentsEnabled("short")).toBe(false);
    expect(
      profileOfType(await store.list(), "long", "并行团队").settings
        .parallelSubagents
    ).toBe(true);
  });

  it("enabling another team replaces only the enabled team of that type", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const initial = await store.list();
    const firstShort = profileOfType(initial, "short");
    const long = profileOfType(initial, "long");
    await store.setEnabled({ teamId: firstShort.id, enabled: true });
    await store.setEnabled({ teamId: long.id, enabled: true });
    const created = await store.create({
      name: "第二短篇团队",
      workspaceType: "short"
    });
    const secondShort = profileOfType(created, "short", "第二短篇团队");
    const result = await store.setEnabled({
      teamId: secondShort.id,
      enabled: true
    });

    expect(result.enabledTeamIds).toEqual({
      short: secondShort.id,
      long: long.id
    });
  });

  it("exports and installs a complete team as a disabled independent copy", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const snapshot = await store.list();
    const source = profileOfType(snapshot, "short");
    const settings = structuredClone(source.settings);
    settings.teams[0]!.subagents.push({
      id: "package_reviewer",
      name: "压缩包审阅",
      description: "验证完整安装",
      systemPrompt: "检查团队压缩包。",
      enabled: true,
      agentMode: "standard",
      modelMode: "inherit"
    });
    await store.save({ teamId: source.id, settings });

    const exported = await store.exportProfile({ teamId: source.id });
    const installed = await store.installProfile(exported);

    expect(installed.team.id).not.toBe(source.id);
    expect(installed.team.name).toBe(`${source.name} (2)`);
    expect(installed.team.settings).toEqual(settings);
    expect(installed.catalog.enabledTeamIds.short).toBeUndefined();
  });

  it("rejects duplicate names and invalid legacy input without overwriting it", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    await store.create({ name: "审稿团队", workspaceType: "short" });
    await expect(
      store.create({ name: "审稿团队", workspaceType: "long" })
    ).rejects.toThrow("已存在");

    const invalidRoot = await temporaryRoot();
    await mkdir(join(invalidRoot, "config"));
    await writeFile(
      join(invalidRoot, "config", "agent-teams.json"),
      JSON.stringify({ version: 1, workspaceType: "short", teams: [] })
    );
    await expect(new AgentTeamConfigStore(invalidRoot).list()).rejects.toThrow(
      "已停止加载"
    );
    await expect(
      readFile(join(invalidRoot, "config", "agent-team-profiles.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues its serialized write queue after a persistence failure", async () => {
    const root = await temporaryRoot();
    const configPath = join(root, "config");
    await writeFile(configPath, "not-a-directory");
    const store = new AgentTeamConfigStore(root);

    await expect(
      store.create({ name: "首次创建", workspaceType: "short" })
    ).rejects.toBeTruthy();
    await unlink(configPath);
    await mkdir(configPath);
    const recovered = await store.create({
      name: "恢复后的团队",
      workspaceType: "short"
    });
    expect(recovered.teams.some((team) => team.name === "恢复后的团队")).toBe(
      true
    );
  });
});
