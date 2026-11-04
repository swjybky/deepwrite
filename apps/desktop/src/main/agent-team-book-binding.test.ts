import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  type AgentTeamProfile,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";

const PARENT = DEFAULT_AGENT_TEAM_SETTINGS.teams[0]!.parentAgentId;
const BOOK = "book-1";
const roots = new Set<string>();

function member(id: string): ShortAgentSubagentDefinition {
  return {
    id,
    name: id,
    description: "成员",
    systemPrompt: "完成任务。",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit"
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-team-binding-"));
  roots.add(root);
  const store = new AgentTeamConfigStore(root);
  const addTeam = async (
    name: string,
    memberIds: string[],
    parallelSubagents = false
  ): Promise<AgentTeamProfile> => {
    const created = await store.create({ name, workspaceType: "short" });
    const team = created.teams.find((item) => item.name === name)!;
    const settings = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
    settings.parallelSubagents = parallelSubagents;
    settings.teams[0]!.subagents = memberIds.map(member);
    await store.save({ teamId: team.id, settings });
    return team;
  };
  const enabled = await addTeam("启用团队", ["enabled-member"], true);
  await store.setEnabled({ teamId: enabled.id, enabled: true });
  const bound = await addTeam("绑定团队", ["bound-member"]);
  const memberIds = async (bookId?: string) =>
    (await store.resolve("short", PARENT, bookId)).map((item) => item.id);
  return {
    root,
    store,
    addTeam,
    enabled,
    bound,
    memberIds,
    profilesPath: join(root, "config", "agent-team-profiles.json"),
    bindingsPath: join(root, "config", "agent-team-book-bindings.json")
  };
}

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true }))
  );
  roots.clear();
});

describe("without a book binding", () => {
  it("resolves the enabled team and creates no binding file", async () => {
    const { store, memberIds, bindingsPath } = await setup();

    expect(await memberIds(BOOK)).toEqual(["enabled-member"]);
    expect(await memberIds()).toEqual(["enabled-member"]);
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(true);
    expect((await store.list()).bookBindings).toBeUndefined();
    await expect(stat(bindingsPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still follows switching the enabled team", async () => {
    const { store, bound, memberIds } = await setup();

    await store.setEnabled({ teamId: bound.id, enabled: true });
    expect(await memberIds(BOOK)).toEqual(["bound-member"]);
  });

  it("still returns nothing when no team is enabled", async () => {
    const { store, enabled, memberIds } = await setup();

    await store.setEnabled({ teamId: enabled.id, enabled: false });
    expect(await memberIds(BOOK)).toEqual([]);
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(false);
  });
});

describe("with a book binding", () => {
  it("uses only the bound team, whatever the enabled team does", async () => {
    const { store, enabled, bound, memberIds, addTeam } = await setup();
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id]
    });

    expect(await memberIds(BOOK)).toEqual(["bound-member"]);
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(false);

    const other = await addTeam("新启用团队", ["other-member"], true);
    await store.setEnabled({ teamId: other.id, enabled: true });
    expect(await memberIds(BOOK)).toEqual(["bound-member"]);

    await store.setEnabled({ teamId: other.id, enabled: false });
    expect(await memberIds(BOOK)).toEqual(["bound-member"]);
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(false);

    await store.setEnabled({ teamId: enabled.id, enabled: true });
    expect(await memberIds(BOOK)).toEqual(["bound-member"]);
  });

  it("leaves other books on the enabled team", async () => {
    const { store, bound, memberIds } = await setup();
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id]
    });

    expect(await memberIds("book-2")).toEqual(["enabled-member"]);
    expect(await memberIds()).toEqual(["enabled-member"]);
  });

  it("merges several teams and runs in parallel only if all allow it", async () => {
    const { store, enabled, bound, memberIds, addTeam } = await setup();
    const parallel = await addTeam("并行团队", ["parallel-member"], true);

    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id, parallel.id]
    });
    expect(await memberIds(BOOK)).toEqual(["bound-member", "parallel-member"]);
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(false);

    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [enabled.id, parallel.id]
    });
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(true);
  });

  it("returns to the enabled team when the binding is cleared", async () => {
    const { store, bound, memberIds } = await setup();
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id]
    });
    const cleared = await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: []
    });

    expect(cleared.bookBindings).toBeUndefined();
    expect(await memberIds(BOOK)).toEqual(["enabled-member"]);
  });

  it("keeps the binding across restarts and out of the profiles file", async () => {
    const { root, store, bound, profilesPath, memberIds } = await setup();
    const profilesBefore = await readFile(profilesPath, "utf8");
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id]
    });

    expect(await readFile(profilesPath, "utf8")).toBe(profilesBefore);
    await store.setEnabled({ teamId: bound.id, enabled: false });
    expect(await readFile(profilesPath, "utf8")).not.toContain("bookBindings");

    const reopened = new AgentTeamConfigStore(root);
    expect((await reopened.list()).bookBindings).toEqual({
      [BOOK]: [bound.id]
    });
    expect(await reopened.resolve("short", PARENT, BOOK)).toEqual(
      await store.resolve("short", PARENT, BOOK)
    );
    expect(await memberIds(BOOK)).toEqual(["bound-member"]);
  });

  it("returns the bindings from every catalog mutation", async () => {
    const { store, bound } = await setup();
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id]
    });

    const renamed = await store.rename({ teamId: bound.id, name: "改名团队" });
    expect(renamed.bookBindings).toEqual({ [BOOK]: [bound.id] });
  });

  it("rejects unknown teams and teams of another writing type", async () => {
    const { store, bound, memberIds } = await setup();
    const longTeam = (await store.list()).teams.find(
      (team) => team.workspaceType === "long"
    )!;

    await expect(
      store.setBookBinding({
        bookId: BOOK,
        workspaceType: "short",
        teamIds: ["missing"]
      })
    ).rejects.toThrow("智能体团队不存在");
    await expect(
      store.setBookBinding({
        bookId: BOOK,
        workspaceType: "short",
        teamIds: [bound.id, longTeam.id]
      })
    ).rejects.toThrow("写作类型不一致");
    expect(await memberIds(BOOK)).toEqual(["enabled-member"]);
  });
});

describe("when bound teams stop working", () => {
  it("fails without using the enabled team", async () => {
    const { store, enabled, bindingsPath, memberIds } = await setup();
    await writeFile(
      bindingsPath,
      JSON.stringify({ version: 1, bindings: { [BOOK]: ["missing-team"] } })
    );

    await expect(memberIds(BOOK)).rejects.toThrow("绑定的智能体团队已失效");
    await store.setEnabled({ teamId: enabled.id, enabled: true });
    await expect(memberIds(BOOK)).rejects.toThrow("绑定的智能体团队已失效");
    expect(await store.parallelSubagentsEnabled("short", BOOK)).toBe(false);
  });

  it("fails when the bound team has no member for this agent", async () => {
    const { store, addTeam, memberIds } = await setup();
    const empty = await addTeam("空团队", []);
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [empty.id]
    });

    await expect(memberIds(BOOK)).rejects.toThrow("没有当前智能体可用的成员");
  });

  it("refuses more members than one run can take", async () => {
    const { store, addTeam, memberIds } = await setup();
    const ids = (prefix: string) =>
      Array.from({ length: 40 }, (_, index) => `${prefix}-${index}`);
    const first = await addTeam("大团队甲", ids("a"));
    const second = await addTeam("大团队乙", ids("b"));
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [first.id, second.id]
    });

    await expect(memberIds(BOOK)).rejects.toThrow("超过单次运行 60 个的上限");
  });

  it("refuses to read a corrupt binding file as no bindings", async () => {
    const { bindingsPath, memberIds } = await setup();
    await writeFile(bindingsPath, JSON.stringify({ version: 1, bindings: 7 }));

    await expect(memberIds(BOOK)).rejects.toThrow("作品团队绑定配置无效");
  });
});

describe("cleaning up bindings", () => {
  it("removes a deleted team and returns emptied books to the default", async () => {
    const { store, bound, addTeam, memberIds } = await setup();
    const kept = await addTeam("保留团队", ["kept-member"]);
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [bound.id, kept.id]
    });
    await store.setBookBinding({
      bookId: "book-2",
      workspaceType: "short",
      teamIds: [bound.id]
    });

    const deleted = await store.delete({ teamId: bound.id });

    expect(deleted.bookBindings).toEqual({ [BOOK]: [kept.id] });
    expect(await memberIds(BOOK)).toEqual(["kept-member"]);
    expect(await memberIds("book-2")).toEqual(["enabled-member"]);
  });

  it("keeps bindings when deleting a team is refused", async () => {
    const { store, enabled } = await setup();
    await store.setBookBinding({
      bookId: BOOK,
      workspaceType: "short",
      teamIds: [enabled.id]
    });

    await expect(store.delete({ teamId: enabled.id })).rejects.toThrow(
      "已启用的团队不能删除"
    );
    expect((await store.list()).bookBindings).toEqual({
      [BOOK]: [enabled.id]
    });
  });

  it("forgets a deleted book without touching other bindings", async () => {
    const { store, bound } = await setup();
    for (const bookId of [BOOK, "book-2"]) {
      await store.setBookBinding({
        bookId,
        workspaceType: "short",
        teamIds: [bound.id]
      });
    }

    await store.removeBookBinding(BOOK);
    await store.removeBookBinding("never-bound");

    expect((await store.list()).bookBindings).toEqual({
      "book-2": [bound.id]
    });
  });

  it("does not create a binding file when forgetting an unbound book", async () => {
    const { store, bindingsPath } = await setup();

    await store.removeBookBinding(BOOK);

    await expect(stat(bindingsPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
