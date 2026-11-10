import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTeamConfigStore } from "./agent-team-config-store";

const roots: string[] = [];
const ordinary = {
  id: "reviewer",
  name: "审阅成员",
  description: "保留的普通成员",
  systemPrompt: "审阅文稿。",
  enabled: true,
  agentMode: "standard",
  modelMode: "inherit"
};
const retired = {
  kind: "tavern-preset",
  id: "retired_preset",
  name: "旧预设成员",
  enabled: true,
  tavernPreset: { presetHash: "a".repeat(64) }
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-retired-members-"));
  roots.push(root);
  const store = new AgentTeamConfigStore(root);
  await store.list();
  const path = join(root, "config", "agent-team-profiles.json");
  const raw = JSON.parse(await readFile(path, "utf8"));
  return { root, store, path, raw };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      })
    )
  );
});

describe("retired team member disk compatibility", () => {
  it.each(["short", "script", "long"])(
    "ignores preset members while retaining the %s team and ordinary members",
    async (workspaceType) => {
      const { root, store, path, raw } = await fixture();
      const profile = raw.teams.find(
        (team: { workspaceType: string }) =>
          team.workspaceType === workspaceType
      );
      profile.settings.parallelSubagents = true;
      profile.settings.teams[0].subagents = [retired, ordinary];
      raw.enabledTeamIds[workspaceType] = profile.id;
      const contents = JSON.stringify(raw);
      await writeFile(path, contents);

      const loaded = await store.list();
      const retained = loaded.teams.find((team) => team.id === profile.id)!;
      expect(retained).toEqual({
        ...profile,
        settings: {
          ...profile.settings,
          teams: [{ ...profile.settings.teams[0], subagents: [ordinary] }]
        }
      });
      expect(loaded.enabledTeamIds).toEqual(raw.enabledTeamIds);
      expect(loaded.teams).toHaveLength(raw.teams.length);
      // Reading only ignores the retired members; it does not rewrite user data.
      expect(await readFile(path, "utf8")).toBe(contents);
      expect(await new AgentTeamConfigStore(root).list()).toEqual(loaded);

      // Normal saves persist the surviving team without bringing presets back.
      await store.rename({ teamId: profile.id, name: "已恢复团队" });
      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(
        saved.teams.find((team: { id: string }) => team.id === profile.id)
      ).toMatchObject({ name: "已恢复团队", settings: retained.settings });
    }
  );

  it("loads an empty team when all its members are retired", async () => {
    const { store, path, raw } = await fixture();
    raw.teams[0].settings.teams[0].subagents = [retired];
    await writeFile(path, JSON.stringify(raw));
    const loaded = await store.list();
    expect(loaded.teams[0]!.id).toBe(raw.teams[0].id);
    expect(loaded.teams[0]!.settings.teams[0]!.subagents).toEqual([]);
  });

  it("still rejects invalid ordinary members without overwriting the file", async () => {
    const { store, path, raw } = await fixture();
    raw.teams[0].settings.teams[0].subagents = [
      retired,
      { ...ordinary, systemPrompt: "" }
    ];
    const contents = JSON.stringify(raw);
    await writeFile(path, contents);
    await expect(store.list()).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("filters retired members before migrating an older catalog", async () => {
    const { store, path, raw } = await fixture();
    raw.version = 4;
    raw.teams[0].settings.teams[0].subagents = [retired, ordinary];
    await writeFile(path, JSON.stringify(raw));
    const loaded = await store.list();
    expect(loaded.teams[0]!.settings.teams[0]!.subagents).toEqual([ordinary]);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.version).toBe(5);
    expect(saved.teams[0].settings.teams[0].subagents).toEqual([ordinary]);
  });
});
