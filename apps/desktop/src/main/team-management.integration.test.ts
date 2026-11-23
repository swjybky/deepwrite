import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentTeamChangeSchema,
  AgentUserInputRequestedPayloadSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  defaultBuiltinSubagentSettings,
  type AgentTeamChange,
  type AgentTeamWorkspaceType,
  type AgentTeamModelChoice,
  type CommandEnvelope,
  type LibraryManagementScope
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  activeTeamRevision,
  listActiveTeams,
  previewActiveTeamChange
} from "./agent-team-active-management";
import { handleTeamManagementCommand } from "./team-management-bridge";
import { teamPromptReviews } from "./team-prompt-reviews";
import type { MainInternalCommandActiveRun } from "./internal-command-authorizer";

const models: AgentTeamModelChoice[] = [
  {
    id: "test-model",
    label: "Test model",
    kind: "llm",
    reasoning: false,
    thinkingLevelOptions: ["low", "high"],
    temperatureOptions: [0.7]
  }
];
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
  const previewInput = {
    scope,
    teamId: profile.id,
    baseRevision: activeTeamRevision(
      (await store.list()).teams.find((t) => t.id === profile.id)!
    ),
    summary: "明确检查步骤",
    operations: [
      {
        action: "update-member" as const,
        parentAgentId: target.parentAgentId,
        memberId: "editor",
        promptReplacements: [
          {
            originalText: "核对因果。",
            newText: "逐项核对剧情因果并列出依据。"
          }
        ]
      }
    ]
  };
  const preview = previewActiveTeamChange(
    await store.list(),
    previewInput,
    models
  );
  const change = AgentTeamChangeSchema.strip().parse(preview);
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
      models?: AgentTeamModelChoice[];
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
      changed,
      async () => options.models ?? models
    );
  }
  function review(patch: Partial<AgentTeamChange> = {}, selected = ["accept"]) {
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
        teamReview: {
          ...actual,
          teamName: profile.name,
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
    previewInput,
    activeRuns,
    command,
    review,
    changed
  };
}

describe("effective team management", () => {
  it.each([
    ["short", "bound"],
    ["script", "bound"],
    ["long", "bound"],
    ["short", "enabled"],
    ["script", "enabled"],
    ["long", "enabled"]
  ] as const)(
    "lists, reads, previews and saves %s %s team with exact consent",
    async (type, source) => {
      const f = await fixture(type, source);
      const listed = await f.command("agentTeams.listActive", {
        scope: f.scope
      });
      expect(listed).toMatchObject({
        status: "accepted",
        payload: {
          teams: [
            {
              id: f.target.teamId,
              enabledAsDefault: source === "enabled",
              members: [{ id: "editor", enabled: false }]
            }
          ],
          models
        }
      });
      expect(JSON.stringify(listed)).not.toContain("保留人物动机");
      expect(
        await f.command("agentTeams.readActiveMembers", {
          scope: f.scope,
          teamId: f.target.teamId,
          members: [
            { parentAgentId: f.target.parentAgentId, memberId: "editor" }
          ]
        })
      ).toMatchObject({
        status: "accepted",
        payload: { members: [{ systemPrompt: "保留人物动机。\n核对因果。" }] }
      });
      expect(
        await f.command("agentTeams.previewActiveChange", f.previewInput)
      ).toMatchObject({ status: "accepted", payload: f.change });
      const save = () =>
        f.command("agentTeams.applyActiveChange", {
          ...f.change,
          reviewRequestId: "review"
        });
      expect(await save()).toMatchObject({ status: "rejected" });
      f.review();
      expect(await save()).toMatchObject({ status: "accepted" });
      const saved = await new AgentTeamConfigStore(f.root).list();
      expect(
        saved.teams.find((t) => t.id === f.target.teamId)!.settings.teams[0]!
          .subagents[0]
      ).toEqual(f.change.members[0]!.after);
      expect(saved.bookBindings).toEqual(
        source === "bound" ? { "test-book": [f.target.teamId] } : undefined
      );
      expect(f.changed).toHaveBeenCalledExactlyOnceWith(f.target.teamId);
      expect(await save()).toMatchObject({ status: "rejected" });
    }
  );

  it("updates member settings and accepts a configured evaluator level in temperature mode", async () => {
    const f = await fixture();
    const snapshot = await f.store.list();
    const preview = previewActiveTeamChange(
      snapshot,
      {
        ...f.previewInput,
        operations: [
          {
            action: "update-member",
            parentAgentId: f.target.parentAgentId,
            memberId: "editor",
            set: {
              name: "新名称",
              description: "新职责",
              enabled: true,
              agentMode: "pure-bare",
              webSearchMode: "on",
              modelMode: "custom",
              modelId: "test-model",
              thinkingLevel: "off",
              temperature: 0.7,
              draw: {
                enabled: true,
                count: 3,
                selection: "auto",
                evaluator: {
                  modelMode: "custom",
                  modelId: "test-model",
                  thinkingLevel: "high"
                }
              }
            }
          },
          {
            action: "add-member",
            parentAgentId: f.target.parentAgentId,
            member: {
              name: "新增成员",
              description: "负责新任务",
              systemPrompt: "完成任务"
            }
          },
          { action: "set-parallel", enabled: true }
        ]
      },
      models
    );
    const change = AgentTeamChangeSchema.strip().parse(preview);
    f.review(change);
    expect(
      await f.command("agentTeams.applyActiveChange", {
        ...change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "accepted" });
    const saved = (await f.store.list()).teams.find(
      (t) => t.id === f.target.teamId
    )!;
    expect(saved.settings.parallelSubagents).toBe(true);
    expect(saved.settings.teams[0]!.subagents).toEqual(
      change.members.map((m) => m.after)
    );
    expect(
      saved.settings.teams[0]!.subagents[0]?.draw?.evaluator
    ).toMatchObject({ modelId: "test-model", thinkingLevel: "high" });
    const removal = previewActiveTeamChange(
      await f.store.list(),
      {
        ...f.previewInput,
        baseRevision: activeTeamRevision(saved),
        operations: [
          {
            action: "remove-member",
            parentAgentId: f.target.parentAgentId,
            memberId: "editor"
          }
        ]
      },
      models
    );
    f.review(AgentTeamChangeSchema.strip().parse(removal));
    expect(
      await f.command("agentTeams.applyActiveChange", {
        ...AgentTeamChangeSchema.strip().parse(removal),
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "accepted" });
    expect(
      (await f.store.list()).teams.find((t) => t.id === f.target.teamId)!
        .settings.teams[0]!.subagents
    ).toHaveLength(1);
  });

  it("rejects invalid models, duplicate ids and ambiguous prompt patches without changing disk", async () => {
    const f = await fixture();
    for (const operations of [
      [
        {
          action: "update-member",
          parentAgentId: f.target.parentAgentId,
          memberId: "editor",
          set: {
            modelMode: "custom",
            modelId: "missing",
            thinkingLevel: "high"
          }
        }
      ],
      [
        {
          action: "update-member",
          parentAgentId: f.target.parentAgentId,
          memberId: "editor",
          set: {
            modelMode: "custom",
            modelId: "test-model",
            thinkingLevel: "medium"
          }
        }
      ],
      [
        {
          action: "update-member",
          parentAgentId: f.target.parentAgentId,
          memberId: "editor",
          set: {
            modelMode: "custom",
            modelId: "test-model",
            thinkingLevel: "off",
            temperature: 0.6
          }
        }
      ],
      [
        {
          action: "update-member",
          parentAgentId: f.target.parentAgentId,
          memberId: "editor",
          set: {
            draw: {
              enabled: true,
              evaluator: {
                evaluationMethod: "jev",
                modelMode: "inherit",
                modelId: "test-model"
              }
            }
          }
        }
      ],
      [
        {
          action: "add-member",
          parentAgentId: f.target.parentAgentId,
          member: {
            id: "editor",
            name: "其他成员",
            description: "工作",
            systemPrompt: "工作"
          }
        }
      ],
      [
        {
          action: "update-member",
          parentAgentId: f.target.parentAgentId,
          memberId: "editor",
          promptReplacements: [{ originalText: "。", newText: "!" }]
        }
      ]
    ]) {
      expect(
        await f.command("agentTeams.previewActiveChange", {
          ...f.previewInput,
          operations
        })
      ).toMatchObject({ status: "rejected" });
    }
    expect(
      (await f.store.list()).teams.find((t) => t.id === f.target.teamId)!
        .settings
    ).toEqual(f.profile.settings);
  });

  it("rejects changes to the reviewed content, rejection, skip and mixed consent", async () => {
    const f = await fixture();
    for (const selected of [["reject"], ["skip"], ["accept", "reject"]]) {
      f.review({}, selected);
      expect(
        await f.command("agentTeams.applyActiveChange", {
          ...f.change,
          reviewRequestId: "review"
        })
      ).toMatchObject({ status: "rejected" });
    }
    f.review();
    const changed = structuredClone(f.change);
    changed.members[0]!.after!.systemPrompt = "未审阅内容";
    expect(
      await f.command("agentTeams.applyActiveChange", {
        ...changed,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "rejected" });
    expect(f.changed).not.toHaveBeenCalled();
  });

  it("checks that the reviewed model is still available when saving", async () => {
    const f = await fixture();
    const review = previewActiveTeamChange(
      await f.store.list(),
      {
        ...f.previewInput,
        operations: [
          {
            action: "update-member",
            parentAgentId: f.target.parentAgentId,
            memberId: "editor",
            set: {
              modelMode: "custom",
              modelId: "test-model",
              thinkingLevel: "off",
              temperature: 0.7
            }
          }
        ]
      },
      models
    );
    const change = AgentTeamChangeSchema.strip().parse(review);
    f.review(change);
    expect(
      await f.command(
        "agentTeams.applyActiveChange",
        {
          ...change,
          reviewRequestId: "review"
        },
        { models: [] }
      )
    ).toMatchObject({ status: "rejected" });
    expect(
      (await f.store.list()).teams.find((t) => t.id === f.target.teamId)!
        .settings
    ).toEqual(f.profile.settings);
  });

  it("rejects stale preview and serializes competing saves against one baseline", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      f.store.applyActiveChange(f.change, models),
      f.store.applyActiveChange(f.change, models)
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(
      await f.command("agentTeams.previewActiveChange", f.previewInput)
    ).toMatchObject({ status: "rejected" });
    f.review();
    expect(
      await f.command("agentTeams.applyActiveChange", {
        ...f.change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "rejected" });
  });

  it("uses bindings before defaults, preserves shared scope and rejects stale team selection", async () => {
    const f = await fixture();
    await f.store.setBookBinding({
      bookId: "other-book",
      workspaceType: "short",
      teamIds: [f.target.teamId]
    });
    const added = await f.store.create({
      workspaceType: "short",
      name: "另一个团队"
    });
    const other = added.teams.find((t) => t.name === "另一个团队")!;
    await f.store.setEnabled({ teamId: other.id, enabled: true });
    let snapshot = await f.store.list();
    expect(listActiveTeams(snapshot, f.scope, models).teams).toMatchObject([
      { id: f.target.teamId, boundBookCount: 2 }
    ]);
    expect(
      listActiveTeams(
        { ...snapshot, bookBindings: { [f.scope.bookId]: ["missing"] } },
        f.scope,
        models
      ).teams
    ).toEqual([]);
    f.review();
    await f.store.setBookBinding({
      bookId: f.scope.bookId,
      workspaceType: "short",
      teamIds: []
    });
    snapshot = await f.store.list();
    expect(
      listActiveTeams(snapshot, f.scope, models).teams.map((t) => t.id)
    ).toEqual([other.id]);
    expect(
      await f.command("agentTeams.applyActiveChange", {
        ...f.change,
        reviewRequestId: "review"
      })
    ).toMatchObject({ status: "rejected" });
    await f.store.setEnabled({ teamId: other.id, enabled: false });
    expect(
      await f.command("agentTeams.listActive", { scope: f.scope })
    ).toMatchObject({ status: "accepted", payload: { teams: [] } });
  });

  it("checks run, session, request origin, work type and live tool enabled state", async () => {
    const f = await fixture();
    for (const options of [
      { sessionId: "other" },
      { parentRequestId: "other" },
      { resourceId: "other" }
    ])
      expect(
        await f.command(
          "agentTeams.previewActiveChange",
          f.previewInput,
          options
        )
      ).toMatchObject({ status: "rejected" });
    for (const scope of [
      { bookId: "other", bookType: "short" },
      { bookId: f.scope.bookId, bookType: "long" }
    ] as LibraryManagementScope[])
      expect(
        await f.command("agentTeams.previewActiveChange", {
          ...f.previewInput,
          scope
        })
      ).toMatchObject({ status: "rejected" });
    await f.store.saveBuiltins(defaultBuiltinSubagentSettings());
    expect(
      await f.command("agentTeams.listActive", { scope: f.scope })
    ).toMatchObject({ status: "rejected" });
  });
});
