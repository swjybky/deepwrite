import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentTeamPromptChangeSchema,
  AgentUserInputRequestedPayloadSchema,
  BuiltinSubagentSettingsSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  defaultBuiltinSubagentSettings,
  type AgentTeamPromptChange,
  type AgentTeamWorkspaceType,
  type CommandEnvelope,
  type LibraryManagementScope
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  listActiveTeamPrompts,
  readActiveTeamPrompt
} from "./agent-team-prompt-management";
import { handleTeamManagementCommand } from "./team-management-bridge";
import { teamPromptReviews } from "./team-prompt-reviews";
import type { MainInternalCommandActiveRun } from "./internal-command-authorizer";

const roots: string[] = [];
afterEach(async () => {
  teamPromptReviews.clear("run");
  await Promise.all(
    roots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      })
    )
  );
});

async function fixture(
  workspaceType: AgentTeamWorkspaceType = "short",
  source: "bound" | "enabled" = "bound"
) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-team-prompts-"));
  roots.push(root);
  const store = new AgentTeamConfigStore(root);
  const builtinSettings = defaultBuiltinSubagentSettings();
  builtinSettings.team.enabled = true;
  await store.saveBuiltins(builtinSettings);
  const catalog = await store.list();
  const profile = catalog.teams.find(
    (team) => team.workspaceType === workspaceType
  )!;
  profile.settings.teams[0]!.subagents = [
    {
      id: "editor",
      name: "提示词测试成员",
      description: "检查剧情因果",
      systemPrompt: "保留人物动机。\n核对因果。",
      enabled: false,
      modelMode: "inherit",
      agentMode: "pure-read"
    }
  ];
  await store.save({ teamId: profile.id, settings: profile.settings });
  const scope = { bookId: "test-book", bookType: workspaceType };
  if (source === "bound")
    await store.setBookBinding({
      bookId: scope.bookId,
      workspaceType,
      teamIds: [profile.id]
    });
  else await store.setEnabled({ teamId: profile.id, enabled: true });
  const target = {
    scope,
    teamId: profile.id,
    parentAgentId: profile.settings.teams[0]!.parentAgentId,
    memberId: "editor"
  };
  const change: AgentTeamPromptChange = {
    ...target,
    previousPrompt: "保留人物动机。\n核对因果。",
    prompt: "保留人物动机。\n逐项核对剧情因果并列出依据。",
    summary: "明确检查步骤与输出要求"
  };
  const activeRuns = new Map<string, MainInternalCommandActiveRun>([
    [
      "run",
      {
        sessionId: "session",
        promptRequestId: "parent",
        accepted: true,
        teamManagementScope: scope
      }
    ]
  ]);
  const changed = vi.fn();
  async function command(
    type: CommandEnvelope["type"],
    payload: unknown,
    options: {
      sessionId?: string;
      parentRequestId?: string;
      resourceId?: string;
    } = {}
  ) {
    const envelope = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, {
        id: "command",
        context: {
          sessionId: options.sessionId ?? "session",
          runId: "run",
          resourceId: options.resourceId ?? scope.bookId
        }
      })
    );
    return handleTeamManagementCommand(
      {
        source: "agent",
        target: "core",
        message: {
          kind: "utility.internal.command.request",
          worker: "agent",
          target: "core",
          requestId: "bridge",
          parentRequestId: options.parentRequestId ?? "parent",
          timeoutMs: 60_000,
          command: envelope
        }
      },
      activeRuns,
      () => store,
      changed
    );
  }
  function review(
    patch: Partial<AgentTeamPromptChange> = {},
    selected = ["accept"]
  ) {
    const actual = { ...change, ...patch };
    teamPromptReviews.receive(
      AgentUserInputRequestedPayloadSchema.parse({
        sessionId: "session",
        runId: "run",
        requestId: "review",
        toolCallId: "propose",
        source: "agent_team_prompt",
        questions: [
          {
            id: "team-prompt",
            question: "审阅提示词",
            options: [
              { id: "accept", label: "保存" },
              { id: "reject", label: "拒绝" }
            ]
          }
        ],
        promptReview: {
          ...actual,
          teamName: profile.name,
          memberName: "提示词测试成员",
          boundBookCount: source === "bound" ? 1 : 0,
          enabledAsDefault: source === "enabled"
        },
        runtime: { provider: "test", model: "test", mode: "local-faux" }
      })
    );
    teamPromptReviews.answer({
      sessionId: "session",
      runId: "run",
      requestId: "review",
      answers: [{ id: "team-prompt", selectedOptionIds: selected }]
    });
  }
  return {
    root,
    store,
    scope,
    profile,
    target,
    change,
    activeRuns,
    command,
    review,
    changed
  };
}

describe("effective team prompt management", () => {
  it.each([
    ["short", "bound"],
    ["script", "bound"],
    ["long", "bound"],
    ["short", "enabled"],
    ["script", "enabled"],
    ["long", "enabled"]
  ] as const)(
    "reads and saves reviewed %s %s team prompts without changing other member settings",
    async (type, source) => {
      const f = await fixture(type, source);
      const listed = listActiveTeamPrompts(await f.store.list(), f.scope);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.members[0]).toMatchObject({
        id: "editor",
        enabled: false
      });
      expect(listed[0]!.enabledAsDefault).toBe(source === "enabled");
      expect(
        await f.command("agentTeams.listActivePrompts", { scope: f.scope })
      ).toMatchObject({
        status: "accepted",
        payload: [{ id: f.target.teamId }]
      });
      expect(JSON.stringify(listed)).not.toContain("保留人物动机");
      expect(
        await f.command("agentTeams.readActivePrompt", f.target)
      ).toMatchObject({
        status: "accepted",
        payload: { prompt: f.change.previousPrompt }
      });
      f.review();
      expect(
        await f.command("agentTeams.applyActivePrompt", {
          ...f.change,
          reviewRequestId: "review"
        })
      ).toMatchObject({
        status: "accepted",
        payload: { prompt: f.change.prompt }
      });
      const saved = await new AgentTeamConfigStore(f.root).list();
      const member = saved.teams.find((team) => team.id === f.target.teamId)!
        .settings.teams[0]!.subagents[0]!;
      expect(member).toEqual({
        ...f.profile.settings.teams[0]!.subagents[0],
        systemPrompt: f.change.prompt
      });
      expect(saved.bookBindings).toEqual(
        source === "bound" ? { "test-book": [f.target.teamId] } : undefined
      );
      expect(f.changed).toHaveBeenCalledExactlyOnceWith(f.target.teamId);
      expect(
        await f.command("agentTeams.applyActivePrompt", {
          ...f.change,
          reviewRequestId: "review"
        })
      ).toMatchObject({ status: "rejected" });
    }
  );

  it("uses the enabled team after removing a binding and reports default and shared scope", async () => {
    const f = await fixture();
    await f.store.setEnabled({ teamId: f.target.teamId, enabled: true });
    await f.store.setBookBinding({
      bookId: "another-book",
      workspaceType: "short",
      teamIds: [f.target.teamId]
    });
    expect(
      readActiveTeamPrompt(await f.store.list(), f.target).boundBookCount
    ).toBe(2);
    await f.store.setBookBinding({
      bookId: f.scope.bookId,
      workspaceType: "short",
      teamIds: []
    });
    expect(listActiveTeamPrompts(await f.store.list(), f.scope)).toMatchObject([
      { id: f.target.teamId, enabledAsDefault: true, boundBookCount: 1 }
    ]);
    expect(
      await f.command("agentTeams.readActivePrompt", f.target)
    ).toMatchObject({
      status: "accepted",
      payload: { enabledAsDefault: true }
    });
    f.review();
    expect(
      await f.command("agentTeams.applyActivePrompt", {
        ...f.change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "accepted" });
    expect((await f.store.list()).bookBindings).toEqual({
      "another-book": [f.target.teamId]
    });
  });

  it("uses bound teams in preference to a different enabled team and never expands broken bindings", async () => {
    const f = await fixture();
    const added = await f.store.create({
      workspaceType: "short",
      name: "其他启用团队"
    });
    const other = added.teams.find((team) => team.name === "其他启用团队")!;
    await f.store.setEnabled({ teamId: other.id, enabled: true });
    const snapshot = await f.store.list();
    expect(
      listActiveTeamPrompts(snapshot, f.scope).map((team) => team.id)
    ).toEqual([f.target.teamId]);
    expect(
      await f.command("agentTeams.readActivePrompt", {
        ...f.target,
        teamId: other.id
      })
    ).toMatchObject({ status: "rejected" });
    expect(
      listActiveTeamPrompts(
        { ...snapshot, bookBindings: { [f.scope.bookId]: ["missing-team"] } },
        f.scope
      )
    ).toEqual([]);
  });

  it("rejects reading and saving an old default team after the enabled team changes", async () => {
    const f = await fixture("short", "enabled");
    f.review();
    const added = await f.store.create({
      workspaceType: "short",
      name: "新启用团队"
    });
    const other = added.teams.find((team) => team.name === "新启用团队")!;
    await f.store.setEnabled({ teamId: other.id, enabled: true });
    expect(
      listActiveTeamPrompts(await f.store.list(), f.scope).map(
        (team) => team.id
      )
    ).toEqual([other.id]);
    expect(
      await f.command("agentTeams.readActivePrompt", f.target)
    ).toMatchObject({ status: "rejected" });
    expect(
      await f.command("agentTeams.applyActivePrompt", {
        ...f.change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "rejected" });
    expect(
      (await f.store.list()).teams.find((team) => team.id === f.target.teamId)!
        .settings.teams[0]!.subagents[0]!.systemPrompt
    ).toBe(f.change.previousPrompt);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it("reports no effective team when no team is bound or enabled", async () => {
    const f = await fixture("short", "enabled");
    await f.store.setEnabled({ teamId: f.target.teamId, enabled: false });
    expect(
      await f.command("agentTeams.listActivePrompts", { scope: f.scope })
    ).toMatchObject({ status: "accepted", payload: [] });
    expect(
      await f.command("agentTeams.readActivePrompt", f.target)
    ).toMatchObject({ status: "rejected" });
    f.review();
    expect(
      await f.command("agentTeams.applyActivePrompt", {
        ...f.change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "rejected" });
  });

  it("requires explicit consent for exactly the reviewed text", async () => {
    const f = await fixture();
    const save = (change = f.change) =>
      f.command("agentTeams.applyActivePrompt", {
        ...change,
        reviewRequestId: "review"
      });
    expect(await save()).toMatchObject({ status: "rejected" });
    f.review({}, ["reject"]);
    expect(await save()).toMatchObject({ status: "rejected" });
    f.review();
    expect(
      await save({ ...f.change, prompt: "未经过审阅的内容" })
    ).toMatchObject({ status: "rejected" });
    expect(readActiveTeamPrompt(await f.store.list(), f.target).prompt).toBe(
      f.change.previousPrompt
    );
    expect(f.changed).not.toHaveBeenCalled();
  });

  it("rejects concurrent changes and serializes competing saves against the same baseline", async () => {
    const f = await fixture();
    const competing = { ...f.change, prompt: "人工刚保存的内容" };
    await f.store.applyActivePrompt(competing);
    f.review();
    const rejected = await f.command("agentTeams.applyActivePrompt", {
      ...f.change,
      reviewRequestId: "review"
    });
    expect(rejected).toMatchObject({
      status: "rejected",
      error: { message: expect.stringContaining("其他操作") }
    });
    expect(readActiveTeamPrompt(await f.store.list(), f.target).prompt).toBe(
      competing.prompt
    );
    const newBase = { ...f.change, previousPrompt: competing.prompt };
    const results = await Promise.allSettled([
      f.store.applyActivePrompt(newBase),
      f.store.applyActivePrompt({ ...newBase, prompt: "第二个写入" })
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected"
    ]);
  });

  it("checks run, session, request origin, work type and the live enabled state", async () => {
    const f = await fixture();
    for (const options of [
      { sessionId: "another-session" },
      { parentRequestId: "another-parent" },
      { resourceId: "another-book" }
    ]) {
      expect(
        await f.command("agentTeams.readActivePrompt", f.target, options)
      ).toMatchObject({ status: "rejected" });
    }
    for (const scope of [
      { bookId: "another-book", bookType: "short" },
      { bookId: f.scope.bookId, bookType: "long" }
    ] as LibraryManagementScope[]) {
      expect(
        await f.command("agentTeams.readActivePrompt", { ...f.target, scope })
      ).toMatchObject({ status: "rejected" });
    }
    const settings = defaultBuiltinSubagentSettings();
    settings.team.enabled = false;
    await f.store.saveBuiltins(settings);
    expect(
      await f.command("agentTeams.readActivePrompt", f.target)
    ).toMatchObject({ status: "rejected" });
  });

  it("adds the new manager to existing settings and rejects empty or oversized prompts", () => {
    const defaults = defaultBuiltinSubagentSettings();
    const migrated = BuiltinSubagentSettingsSchema.parse({
      skill: { ...defaults.skill, enabled: false },
      material: { ...defaults.material, description: "已有的素材调用说明" }
    });
    expect(migrated.team).toEqual(defaults.team);
    expect(migrated.skill.enabled).toBe(false);
    expect(migrated.material.description).toBe("已有的素材调用说明");
    expect(
      BuiltinSubagentSettingsSchema.parse({
        ...defaults,
        team: {
          enabled: false,
          description:
            "仅在用户要求查看、管理或优化当前作品绑定团队的成员提示词时调用。先读取原提示词，修改逐项审阅，明确接受后保存。"
        }
      }).team
    ).toEqual({ ...defaults.team, enabled: false });
    expect(
      BuiltinSubagentSettingsSchema.parse({
        ...defaults,
        team: {
          enabled: true,
          description: "我的自定义管理说明"
        }
      }).team.description
    ).toBe("我的自定义管理说明");
    expect(AgentTeamPromptChangeSchema.safeParse({}).success).toBe(false);
    const target = {
      scope: { bookId: "book", bookType: "short" },
      teamId: "team",
      parentAgentId: "short",
      memberId: "member",
      previousPrompt: "old",
      summary: "summary"
    };
    expect(
      AgentTeamPromptChangeSchema.safeParse({ ...target, prompt: " " }).success
    ).toBe(false);
    expect(
      AgentTeamPromptChangeSchema.safeParse({
        ...target,
        prompt: "字".repeat(20_001)
      }).success
    ).toBe(false);
  });
});
