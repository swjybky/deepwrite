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
  AgentTeamPromptReadResult,
  CommandResult
} from "@deepwrite/contracts";
import {
  createTeamManagementRuntime,
  teamManagementParentPrompt
} from "./team-management-runtime";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { buildRunTools } from "./run-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";

const target = {
  team_id: "team",
  parent_agent_id: "short",
  member_id: "editor"
};
const before: AgentTeamPromptReadResult = {
  scope: { bookType: "short", bookId: "book" },
  teamId: "team",
  parentAgentId: "short",
  memberId: "editor",
  teamName: "测试团队",
  memberName: "测试成员",
  description: "核对剧情",
  boundBookCount: 0,
  enabledAsDefault: true,
  prompt: "原有职责"
};
function fixture(answer = "accept") {
  const executor = vi.fn(async (command): Promise<CommandResult> => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "agentTeams.listActivePrompts"
        ? [
            {
              id: "team",
              name: "测试团队",
              boundBookCount: 0,
              enabledAsDefault: true,
              members: [
                {
                  parentAgentId: "short",
                  id: "editor",
                  name: "测试成员",
                  description: "核对剧情",
                  enabled: true
                }
              ]
            }
          ]
        : {
            ...before,
            ...(command.type === "agentTeams.applyActivePrompt"
              ? { prompt: command.payload.prompt }
              : {})
          }
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
    prompt: "查看并优化当前生效团队的提示词",
    writeApprovalMode: "auto-approve",
    teamManagement: {
      scope: before.scope,
      description: "管理当前生效团队提示词"
    },
    teamManagementCommandExecutor: executor
  };
  const runtime = createTeamManagementRuntime(input, request);
  return { input, executor, request, runtime };
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

describe("team management subagent", () => {
  it("uses only team tools and demands a fresh read before proposing", async () => {
    const f = fixture();
    const child = await f.runtime.prepareChild(f.runtime.definitions[0]!);
    expect(child.tools.map((tool) => tool.name)).toEqual([
      "list_active_agent_teams",
      "read_agent_team_prompt",
      "propose_agent_team_prompt"
    ]);
    await expect(
      child.tools[2]!.execute("propose", {
        ...target,
        prompt: "新职责",
        summary: "明确职责"
      })
    ).rejects.toThrow("先用 read_agent_team_prompt");
    await child.tools[0]!.execute("list", {});
    await child.tools[1]!.execute("read", target);
    expect(f.executor.mock.calls[1]![0]).toMatchObject({
      type: "agentTeams.readActivePrompt",
      context: { resourceId: "book", sessionId: "session", runId: "run" },
      payload: { scope: before.scope }
    });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(["accept", "reject", "skip"])(
    "waits for explicit %s review even with automatic approval enabled",
    async (answer) => {
      const f = fixture(answer);
      const child = await f.runtime.prepareChild(f.runtime.definitions[0]!);
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
      const pending = child.tools[2]!.execute("propose", {
        ...target,
        prompt: "新职责",
        summary: "明确职责"
      });
      await vi.waitFor(() => expect(resolve).toBeDefined());
      expect(f.executor.mock.calls.map(([command]) => command.type)).toEqual([
        "agentTeams.readActivePrompt"
      ]);
      expect(f.request).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "agent_team_prompt",
          promptReview: expect.objectContaining({
            previousPrompt: before.prompt,
            prompt: "新职责",
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
          ([command]) => command.type === "agentTeams.applyActivePrompt"
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
    const child = await f.runtime.prepareChild(f.runtime.definitions[0]!);
    await child.tools[1]!.execute("read", target);
    f.executor.mockResolvedValueOnce({
      status: "rejected",
      requestId: "save",
      error: { code: "test.conflict", message: "版本冲突" }
    });
    const args = { ...target, prompt: "新职责", summary: "明确职责" };
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
    "mounts in standard/team mode (%s) and delegates without inheriting workspace tools",
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
      expect(tools.some((tool) => tool.name === "spawn_subagent")).toBe(true);
      expect(
        tools.some((tool) => tool.name === "propose_agent_team_prompt")
      ).toBe(false);
      p.faux.setResponses([
        fauxAssistantMessage(fauxToolCall("list_active_agent_teams", {}), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage(fauxToolCall("read_agent_team_prompt", target), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage(
          fauxToolCall("propose_agent_team_prompt", {
            ...target,
            prompt: "新职责",
            summary: "明确职责"
          }),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("提示词已按审阅结果保存。")
      ]);
      const buildChildTools = vi.fn(() => {
        throw new Error("不应继承作品写入工具");
      });
      const spawn = buildSpawnSubagentTool({
        parentSessionId: "session",
        ...p,
        thinkingLevel: "off",
        definitions: f.runtime.definitions,
        prepareChild: f.runtime.prepareChild,
        buildChildTools,
        parentRuntime: { provider: "test", model: "test", mode: "provider" },
        getParentMessages: () => [
          { role: "user", content: "请优化团队提示词", timestamp: 1 }
        ]
      })!;
      await spawn.execute("spawn", {
        subagent_id: "builtin:team-manager",
        task: "优化当前生效团队成员提示词"
      });
      expect(buildChildTools).not.toHaveBeenCalled();
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.executor.mock.calls.map(([command]) => command.type)).toEqual([
        "agentTeams.listActivePrompts",
        "agentTeams.readActivePrompt",
        "agentTeams.applyActivePrompt"
      ]);
      expect(teamManagementParentPrompt(f.input)).toContain("不要求用户先绑定");
      const disabledInput = { ...f.input };
      delete disabledInput.teamManagement;
      expect(
        createTeamManagementRuntime(disabledInput, f.request).definitions
      ).toEqual([]);
    }
  );
});
