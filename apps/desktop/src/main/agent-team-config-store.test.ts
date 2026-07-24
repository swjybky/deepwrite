import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  type AgentTeamSettingsInput
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-agent-team-store-"));
  temporaryRoots.add(root);
  return root;
}

function customizedInput(): AgentTeamSettingsInput {
  return {
    workspaceType: "short",
    teams: DEFAULT_AGENT_TEAM_SETTINGS.teams.map((team) => ({
      parentAgentId: team.parentAgentId,
      subagents:
        team.parentAgentId === "outline"
          ? [
              {
                id: "outline_reviewer",
                name: "大纲审阅",
                description: "检查大纲逻辑与缺漏。",
                systemPrompt: "审阅大纲并只向主智能体返回摘要。",
                enabled: true,
                modelMode: "inherit" as const
              },
              {
                id: "disabled_helper",
                name: "停用助手",
                description: "暂时不参与工作。",
                systemPrompt: "当前已停用。",
                enabled: false,
                modelMode: "inherit" as const
              }
            ]
          : []
    }))
  };
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("AgentTeamConfigStore", () => {
  it("returns cloned five-team defaults when no file exists", async () => {
    const settings = await new AgentTeamConfigStore(
      await makeTemporaryRoot()
    ).list();

    expect(settings).toEqual(DEFAULT_AGENT_TEAM_SETTINGS);
    expect(settings).not.toBe(DEFAULT_AGENT_TEAM_SETTINGS);
    expect(settings.teams).not.toBe(DEFAULT_AGENT_TEAM_SETTINGS.teams);
  });

  it("persists atomically and resolves only enabled definitions", async () => {
    const root = await makeTemporaryRoot();
    const store = new AgentTeamConfigStore(root);

    const saved = await store.save(customizedInput());

    expect(await store.list()).toEqual(saved);
    expect(await store.resolve("outline")).toEqual([
      expect.objectContaining({ id: "outline_reviewer", enabled: true })
    ]);
    const disk = JSON.parse(
      await readFile(join(root, "config", "agent-teams.json"), "utf8")
    ) as { version: number };
    expect(disk.version).toBe(1);
  });

  it("rejects an invalid disk shape instead of silently overwriting it", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    await writeFile(
      join(root, "config", "agent-teams.json"),
      JSON.stringify({ version: 1, workspaceType: "short", teams: [] }),
      "utf8"
    );

    await expect(new AgentTeamConfigStore(root).list()).rejects.toThrow(
      "已停止加载以避免覆盖原文件"
    );
  });

  it("rejects an unknown disk version", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    await writeFile(
      join(root, "config", "agent-teams.json"),
      JSON.stringify({ ...customizedInput(), version: 2 }),
      "utf8"
    );

    await expect(new AgentTeamConfigStore(root).list()).rejects.toThrow(
      "配置版本无效"
    );
  });

  it("continues its write queue after a persistence failure", async () => {
    const root = await makeTemporaryRoot();
    const configPath = join(root, "config");
    await writeFile(configPath, "not-a-directory", "utf8");
    const store = new AgentTeamConfigStore(root);

    await expect(store.save(customizedInput())).rejects.toBeTruthy();

    await unlink(configPath);
    await mkdir(configPath);
    await expect(store.save(customizedInput())).resolves.toEqual(
      customizedInput()
    );
  });
});
