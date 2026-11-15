import { describe, expect, it, vi } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  AgentTeamChangeReview,
  CommandResult
} from "@deepwrite/contracts";
import {
  createTeamManagementRuntime,
  teamManagementParentPrompt
} from "./team-management-runtime";
import { Agent } from "@earendil-works/pi-agent-core";
import { buildRunTools } from "./run-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";

const scope = { bookType: "short" as const, bookId: "book" };
const baseline = "a".repeat(32);
const member = {
  id: "editor",
  name: "测试成员",
  description: "核对剧情",
  systemPrompt: "原有职责",
  enabled: true,
  modelMode: "inherit" as const,
  agentMode: "standard" as const
};
const target = {
  team_id: "team",
  members: [{ parent_agent_id: "short", member_id: "editor" }]
};
const proposal = {
  team_id: "team",
  summary: "明确职责",
  operations: [
    {
      action: "update-member",
      parentAgentId: "short",
      memberId: "editor",
      systemPrompt: "新职责"
    }
  ]
};
const review: AgentTeamChangeReview = {
  scope,
  teamId: "team",
  teamName: "测试团队",
  baseRevision: baseline,
  boundBookCount: 0,
  enabledAsDefault: true,
  summary: "明确职责",
  members: [
    {
      parentAgentId: "short",
      memberId: "editor",
      before: member,
      after: { ...member, systemPrompt: "新职责" }
    }
  ]
};
function fixture(answer = "accept") {
  const executor = vi.fn(async (command): Promise<CommandResult> => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "agentTeams.listActive"
        ? {
            teams: [
              {
                id: "team",
                name: "测试团队",
                boundBookCount: 0,
                enabledAsDefault: true,
                parallelSubagents: false,
                parentAgentIds: ["short"],
                revision: baseline,
                members: [
                  { ...member, systemPrompt: undefined, parentAgentId: "short" }
                ]
              }
            ],
            models: []
          }
        : command.type === "agentTeams.readActiveMembers"
          ? {
              teamId: "team",
              teamName: "测试团队",
              revision: baseline,
              members: [{ ...member, parentAgentId: "short" }]
            }
          : command.type === "agentTeams.previewActiveChange"
            ? review
            : { teamId: "team", revision: "b".repeat(32) }
  }));
  const request = vi.fn<AgentUserInputRequester>(async () => ({
    sessionId: "session",
    runId: "run",
    requestId: "review",
    answers: [{ id: "team-prompt", selectedOptionIds: [answer] }]
  }));
  const input: AgentRunInput = {
    sessionId: "session",
    runId: "run",
    prompt: "优化团队",
    writeApprovalMode: "auto-approve",
    teamManagement: { scope, description: "管理生效团队" },
    teamManagementCommandExecutor: executor
  };
  return {
    input,
    executor,
    request,
    runtime: createTeamManagementRuntime(input, request)
  };
}
function provider() {
  const faux = fauxProvider({
    api: "team-management-test",
    provider: "team-management-test",
    tokensPerSecond: 0,
    models: [{ id: "test", name: "Test", reasoning: true }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    model: faux.getModel("test") as Model<Api>,
    streamFn: models.streamSimple.bind(models) as StreamFn
  };
}

describe("main-agent team management tools", () => {
  it("uses only team tools and demands a fresh read before proposing", async () => {
    const f = fixture();
    const child = f.runtime;
    expect(child.tools.map((tool) => tool.name)).toEqual([
      "list_active_agent_teams",
      "read_agent_team_members",
      "propose_agent_team_change"
    ]);
    await expect(child.tools[2]!.execute("propose", proposal)).rejects.toThrow(
      "请先"
    );
    await child.tools[0]!.execute("list", {});
    await child.tools[1]!.execute("read", target);
    expect(f.executor.mock.calls[1]![0]).toMatchObject({
      type: "agentTeams.readActiveMembers",
      context: { resourceId: "book", sessionId: "session", runId: "run" },
      payload: { scope }
    });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(["accept", "reject", "skip"])(
    "waits for explicit %s review even with automatic approval enabled",
    async (answer) => {
      const f = fixture(answer);
      const child = f.runtime;
      await child.tools[1]!.execute("read", target);
      let resolve:
        | ((value: Awaited<ReturnType<AgentUserInputRequester>>) => void)
        | undefined;
      f.request.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const pending = child.tools[2]!.execute("propose", proposal);
      await vi.waitFor(() => expect(resolve).toBeDefined());
      expect(f.executor.mock.calls.map(([command]) => command.type)).toEqual([
        "agentTeams.readActiveMembers",
        "agentTeams.previewActiveChange"
      ]);
      expect(f.request).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "agent_team_prompt",
          teamReview: expect.objectContaining({
            members: [
              {
                parentAgentId: "short",
                memberId: "editor",
                before: member,
                after: { ...member, systemPrompt: "新职责" }
              }
            ],
            boundBookCount: 0
          })
        }),
        undefined
      );
      resolve!({
        sessionId: "session",
        runId: "run",
        requestId: "review",
        answers: [{ id: "team-prompt", selectedOptionIds: [answer] }]
      });
      const result = await pending;
      expect(
        f.executor.mock.calls.filter(
          ([command]) => command.type === "agentTeams.applyActiveChange"
        )
      ).toHaveLength(answer === "accept" ? 1 : 0);
      expect(result.content).toEqual([
        expect.objectContaining({
          text: expect.stringContaining(
            answer === "accept" ? "已按用户审阅结果保存" : "未保存"
          )
        })
      ]);
    }
  );

  it("invalidates stale read evidence when saving fails and stops on cancellation", async () => {
    const f = fixture();
    const child = f.runtime;
    await child.tools[1]!.execute("read", target);
    f.executor.mockResolvedValueOnce({
      status: "rejected",
      requestId: "save",
      error: { code: "test.conflict", message: "版本冲突" }
    });
    const args = proposal;
    await expect(child.tools[2]!.execute("propose", args)).rejects.toThrow(
      "版本冲突"
    );
    await expect(child.tools[2]!.execute("propose", args)).rejects.toThrow(
      "请先"
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      child.tools[1]!.execute("read", target, aborted.signal)
    ).rejects.toThrow();
  });

  it.each([false, true])(
    "mounts in standard/team mode (%s) and runs directly on the main agent",
    async (teamMode) => {
      const f = fixture();
      const p = provider();
      f.input.workspaceContext = { shortWorkspace: shortWorkspace() };
      f.input.agentProfile = shortProfile();
      if (teamMode)
        f.input.subagentDefinitions = [
          {
            id: "member",
            name: "团队成员",
            description: "创作",
            systemPrompt: "创作",
            enabled: true,
            modelMode: "inherit",
            agentMode: "standard"
          }
        ];
      const tools = buildRunTools(f.input, {
        ...p,
        thinkingLevel: "off",
        parentRuntime: { provider: "test", model: "test", mode: "provider" },
        toolExecutionHooks: {},
        requestUserInput: f.request,
        getParentMessages: () => [],
        portableToolSchemaProfile: "writing-workspace"
      });
      expect(tools.some((tool) => tool.name === "spawn_subagent")).toBe(
        teamMode
      );
      expect(
        tools.some((tool) => tool.name === "propose_agent_team_change")
      ).toBe(true);
      p.faux.setResponses([
        fauxAssistantMessage(fauxToolCall("list_active_agent_teams", {}), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage(fauxToolCall("read_agent_team_members", target), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage(
          fauxToolCall("propose_agent_team_change", proposal),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("提示词已按审阅结果保存。")
      ]);
      const agent = new Agent({
        initialState: {
          model: p.model,
          tools,
          thinkingLevel: "off",
          systemPrompt: teamManagementParentPrompt(f.input)
        },
        streamFn: p.streamFn
      });
      await agent.prompt("优化当前生效团队成员提示词");
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.executor.mock.calls.map(([command]) => command.type)).toEqual([
        "agentTeams.listActive",
        "agentTeams.readActiveMembers",
        "agentTeams.previewActiveChange",
        "agentTeams.applyActiveChange"
      ]);
      expect(teamManagementParentPrompt(f.input)).toContain("不要求用户先绑定");
      const disabledInput = { ...f.input };
      delete disabledInput.teamManagement;
      expect(
        createTeamManagementRuntime(disabledInput, f.request).tools
      ).toEqual([]);
    }
  );
});
