import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentPromptCommandPayloadSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type AgentPromptCommandPayload,
  type AgentProviderRuntimeConfig,
  type AgentTeamRunMode,
  type CommandEnvelope,
  type CommandResult,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  type AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import {
  profile,
  workspace
} from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import type { IpcCommandContext } from "../main/ipc/command-types";
import { releaseConversationRun } from "../main/ipc/conversation-operation-guard";
import { handleSessionCommands } from "../main/ipc/session-commands";
import { createAgentRunInput } from "./agent-run-input";

const SESSION_ID = "session_long_team";
const config: AgentProviderRuntimeConfig = {
  id: "team-fixture",
  label: "Team fixture",
  provider: "openai",
  api: "openai-completions",
  modelId: "team-fixture",
  baseUrl: "https://api.example.test/v1",
  apiKey: "invalid-team-fixture-key",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.7, 1],
  contextWindow: 128_000,
  maxTokens: 4_096
};
const member: ShortAgentSubagentDefinition = {
  id: "chapter_planner",
  name: "章卡规划员",
  description: "整理后续章节的章卡方案。",
  systemPrompt: "整理章卡方案并交回主智能体。",
  enabled: true,
  agentMode: "standard",
  modelMode: "inherit"
};
// Existing saved prompts must work without resetting the user's configuration.
const legacyPrompt =
  "You have exactly nine tools: list, read, create, edit, delete, query_linked_material_entries, load_skill, propose_continuity_commit, and ask_user_question.";

interface ProviderRequest {
  messages: Array<{ role: string; content: string }>;
  tools: Array<{ function: { name: string; description: string } }>;
}

function response(delta: Record<string, unknown>, toolCall = false) {
  return new Response(
    `data: ${JSON.stringify({
      id: "team-response",
      object: "chat.completion.chunk",
      created: 0,
      model: config.modelId,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", ...delta },
          finish_reason: toolCall ? "tool_calls" : "stop"
        }
      ]
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } }
  );
}

function harness(savedPrompt = legacyPrompt) {
  const runtime = new PiAgentRuntimeAdapter({ retryPolicy: { delaysMs: [] } });
  const resolveMembers = vi.fn(async () => [member]);
  const longProfile = { ...profile("long"), systemPrompt: savedPrompt };
  let payload: AgentPromptCommandPayload | undefined;
  let runId = "";
  const requestCommand = vi.fn(
    async (
      worker: string,
      command: CommandEnvelope
    ): Promise<CommandResult> => {
      if (worker === "core" && command.type === "catalog.queryMaterials") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: { status: "ok", entries: [], total: 0, notices: [] }
        };
      }
      if (worker !== "agent" || command.type !== "agent.prompt")
        throw new Error(`Unexpected command: ${command.type}`);
      payload = AgentPromptCommandPayloadSchema.parse(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          sessionId: SESSION_ID,
          runId,
          runtime: runtime.describe(config),
          acceptedAt: "2026-10-21T00:00:00.000Z"
        }
      };
    }
  );
  const ctx = {
    activeRuns: new Map(),
    terminalRuns: new Set(),
    pendingUsageContexts: new Map(),
    supervisor: { requestCommand },
    requireModelConfigStore: () => ({ resolve: async () => config }),
    requireLongAgentConfigStore: () => ({ resolve: async () => longProfile }),
    requireAgentTeamConfigStore: () => ({
      resolve: resolveMembers,
      parallelSubagentsEnabled: async () => true,
      list: async () => ({
        builtinSubagents: {
          skill: { enabled: false, description: "" },
          material: { enabled: false, description: "" }
        }
      })
    }),
    requireLibraryAgentConfigStore: () => ({}),
    requireGeneralSettingsStore: () => ({
      list: async () => ({
        settings: {
          contextCompaction: { enabled: false, budgetTokens: 64_000 }
        }
      })
    })
  } as unknown as IpcCommandContext;

  async function run(mode: AgentTeamRunMode, turn: number) {
    runId = `run_long_team_${turn}`;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "session.prompt",
        {
          sessionId: SESSION_ID,
          message: mode === "team" ? "请 #章卡规划员 整理章卡" : "检查当前章卡",
          modelId: config.id,
          thinkingLevel: "off",
          agentTeamMode: mode,
          workspaceContext: { longWorkspace: workspace("long", "plot_design") }
        },
        { id: `command_long_team_${turn}`, context: { sessionId: SESSION_ID } }
      )
    );
    expect(await handleSessionCommands(ctx, command)).toEqual(
      expect.objectContaining({ status: "accepted" })
    );
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.start(
      createAgentRunInput(payload!, runId, new AbortController().signal)
    ))
      events.push(event);
    // Mirror terminal delivery before sending another turn in this session.
    releaseConversationRun(
      ctx.activeRuns,
      SESSION_ID,
      ctx.activeRuns.get(runId)!.promptRequestId!
    );
    ctx.activeRuns.clear();
    expect(events.filter((event) => event.type === "agent.error")).toEqual([]);
    expect(events.at(-1)?.type).toBe("agent.completed");
    return events;
  }
  return { run, resolveMembers, longProfile };
}

afterEach(() => vi.unstubAllGlobals());

describe("long team from Main through the Agent utility to the provider", () => {
  it("refreshes actual tools in an existing conversation and completes a delegated task with a saved legacy prompt", async () => {
    const requests: ProviderRequest[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 2) {
        return response(
          {
            tool_calls: [
              {
                index: 0,
                id: "spawn_chapter_plan",
                type: "function",
                function: {
                  name: "spawn_subagent",
                  arguments: JSON.stringify({
                    tasks: [{ subagent_id: member.id, task: "整理章卡方案" }]
                  })
                }
              }
            ]
          },
          true
        );
      }
      return response({
        content: requests.length === 3 ? "章卡方案已整理。" : "已完成。"
      });
    });
    const fixture = harness();
    await fixture.run("normal", 1);
    const teamEvents = await fixture.run("team", 2);
    await fixture.run("normal", 3);

    expect(fixture.resolveMembers).toHaveBeenCalledExactlyOnceWith(
      "long",
      "long"
    );
    expect(requests).toHaveLength(5);
    const names = (index: number) =>
      requests[index]!.tools.map(({ function: tool }) => tool.name);
    const boundary = (index: number) =>
      requests[index]!.messages.filter(
        ({ role }) => role === "system" || role === "developer"
      )
        .map(({ content }) => content)
        .join("\n")
        .split("【本轮长篇工具边界】")[1];
    expect(names(0)).not.toContain("spawn_subagent");
    expect(boundary(0)).toContain("本轮没有 spawn_subagent");
    expect(names(1)).toContain("spawn_subagent");
    expect(boundary(1)).toContain("spawn_subagent 已开放");
    expect(boundary(1)).toContain(
      "优先于角色提示词中的固定数量、旧清单与历史回复"
    );
    expect(
      requests[1]!.tools.find(
        ({ function: tool }) => tool.name === "spawn_subagent"
      )?.function.description
    ).toContain(member.name);
    expect(names(2)).toContain("read");
    expect(names(2)).not.toContain("spawn_subagent");
    expect(names(2)).not.toContain("ask_user_question");
    expect(names(4)).not.toContain("spawn_subagent");
    expect(boundary(4)).toContain("本轮没有 spawn_subagent");
    expect(boundary(4)).not.toContain("spawn_subagent 已开放");
    expect(
      teamEvents.filter((event) => event.type === "subagent.started")
    ).toHaveLength(1);
    expect(
      teamEvents.filter((event) => event.type === "subagent.completed")
    ).toMatchObject([
      {
        payload: {
          subagentId: member.id,
          status: "completed",
          summary: "章卡方案已整理。"
        }
      }
    ]);
    expect(fixture.longProfile.systemPrompt).toBe(legacyPrompt);
  });

  it("keeps the builtin prompt open to optional tools without a fixed total", () => {
    const prompt = profile("long").systemPrompt;
    expect(prompt).not.toContain("exactly nine tools");
    expect(prompt).toContain("spawn_subagent");
  });
});
