import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  shortProfile,
  shortWorkspace
} from "../../../../../packages/pi-runtime-adapter/src/short-agent-tools.test-support";
import type { IpcCommandContext } from "./command-types";
import { handleSessionCommands } from "./session-commands";

describe("session user-input commands", () => {
  it("forwards an answer to the authoritative Agent even when Main's run mirror lags", async () => {
    const payload = {
      sessionId: "session_waiting",
      runId: "run_waiting",
      requestId: "request_scope",
      answers: [{ id: "scope", selectedOptionIds: ["all_with_overview"] }]
    };
    const command = CommandEnvelopeSchema.parse(
      createEnvelope("session.user_input_response", payload, {
        id: "command_user_input",
        context: {
          correlationId: "command_user_input",
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    );
    const requestCommand = vi.fn(async () => ({
      status: "accepted" as const,
      requestId: command.id,
      payload: {
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId,
        resolvedAt: "2026-08-22T04:08:00.000Z"
      }
    }));
    const ctx = {
      activeRuns: new Map(),
      supervisor: { requestCommand }
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: {
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId
      }
    });
    expect(requestCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        type: "agent.user_input_response",
        payload
      }),
      10_000
    );
  });
});

describe("session steering commands", () => {
  const payload = {
    sessionId: "session_running",
    runId: "run_running",
    steerId: "steer_rename",
    message: "主角改名林舟"
  };
  const command = CommandEnvelopeSchema.parse(
    createEnvelope("session.steer", payload, {
      id: "command_steer",
      context: {
        correlationId: "command_steer",
        sessionId: payload.sessionId,
        runId: payload.runId
      }
    })
  );
  const settingsStore = (budgetTokens: number) => ({
    list: async () => ({ settings: { contextCompaction: { budgetTokens } } })
  });

  it("forwards a steer to the Agent that owns the run", async () => {
    const requestCommand = vi.fn(async () => ({
      status: "accepted" as const,
      requestId: command.id,
      payload: { ...payload, acceptedAt: "2026-10-28T08:00:00.000Z" }
    }));
    const ctx = {
      activeRuns: new Map(),
      supervisor: { requestCommand },
      requireGeneralSettingsStore: () => settingsStore(64_000)
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { steerId: payload.steerId }
    });
    expect(requestCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ type: "agent.steer", payload }),
      10_000
    );
  });

  it("rejects a steer over the prompt budget before reaching the Agent", async () => {
    const requestCommand = vi.fn();
    const ctx = {
      activeRuns: new Map(),
      supervisor: { requestCommand },
      requireGeneralSettingsStore: () => settingsStore(1)
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: { code: "session.prompt_budget_exceeded" }
    });
    expect(requestCommand).not.toHaveBeenCalled();
  });

  it("rejects an Agent receipt for a different steer", async () => {
    const ctx = {
      activeRuns: new Map(),
      supervisor: {
        requestCommand: vi.fn(async () => ({
          status: "accepted" as const,
          requestId: command.id,
          payload: {
            ...payload,
            steerId: "steer_other",
            acceptedAt: "2026-10-28T08:00:00.000Z"
          }
        }))
      },
      requireGeneralSettingsStore: () => settingsStore(64_000)
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: { code: "ipc.invalid_agent_steer_result" }
    });
  });
});

const searchSettings = {
  providerId: "deepseek" as const,
  baseUrl: "https://search.example.test",
  apiKey: "invalid-test-search-key",
  maxResults: 8,
  perRunCallLimit: 20
};

function promptFixture(
  resolveWebSearch?: () => Promise<unknown>,
  overrides: Record<string, unknown> = {}
) {
  const requestCommand = vi.fn(
    async (
      _worker: string,
      command: CommandEnvelope
    ): Promise<CommandResult> => ({
      status: "accepted",
      requestId: command.id,
      payload:
        command.type === "catalog.queryMaterials"
          ? { status: "ok", entries: [], total: 0, notices: [] }
          : {
              sessionId: "session_workspace_search",
              runId: "run_workspace_search",
              runtime: {
                mode: "provider",
                provider: "openai",
                model: "writer-model"
              },
              acceptedAt: "2026-10-17T00:00:00.000Z"
            }
    })
  );
  const ctx = {
    activeRuns: new Map(),
    terminalRuns: new Set(),
    pendingUsageContexts: new Map(),
    supervisor: { requestCommand },
    requireModelConfigStore: () => ({
      resolve: vi.fn(async () => ({
        id: "writer",
        label: "Writer",
        provider: "openai",
        modelId: "writer-model",
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["low", "high"],
        temperatureOptions: [0.1, 0.7, 1],
        apiKey: "invalid-test-model-key"
      }))
    }),
    requireAgentTeamConfigStore: () => ({}),
    requireLibraryAgentConfigStore: () => ({}),
    requireGeneralSettingsStore: () => ({
      list: async () => ({
        settings: { contextCompaction: { enabled: false, budgetTokens: 16000 } }
      })
    }),
    ...(resolveWebSearch ? { resolveWebSearch } : {}),
    ...overrides
  } as unknown as IpcCommandContext;
  const prompt = (payload: Record<string, unknown> = {}) =>
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "session.prompt",
        {
          sessionId: "session_workspace_search",
          message: "查一下近期同类题材",
          modelId: "writer",
          ...payload
        },
        {
          id: "command_workspace_search",
          context: { sessionId: "session_workspace_search" }
        }
      )
    );
  // The agent.prompt Main hands to the Agent, not Core's catalog queries.
  const internalPayload = () =>
    (
      requestCommand.mock.calls.find(([worker]) => worker === "agent")![1] as {
        payload: Record<string, unknown>;
      }
    ).payload;
  return { ctx, prompt, internalPayload };
}

function teamFixture(
  webSearchMode: "inherit" | "on" | "off" | undefined,
  resolveWebSearch = vi.fn(async () => searchSettings)
) {
  const members = [
    {
      id: "member_check",
      name: "查证员",
      description: "查证公开资料",
      systemPrompt: "只做查证。",
      enabled: true,
      agentMode: "standard" as const,
      modelMode: "inherit" as const,
      ...(webSearchMode ? { webSearchMode } : {})
    }
  ];
  const fixture = promptFixture(resolveWebSearch, {
    requireWorkspaceAgentConfigStore: () => ({
      resolveForWorkspace: async () => shortProfile()
    }),
    requireAgentTeamConfigStore: () => ({
      resolve: async () => members,
      parallelSubagentsEnabled: async () => false,
      // Built-in managers off: no management context is attached.
      list: async () => ({
        builtinSubagents: {
          skill: { enabled: false, description: "" },
          material: { enabled: false, description: "" },
          team: { enabled: false, description: "管理团队" }
        }
      })
    })
  });
  const prompt = (payload: Record<string, unknown> = {}) =>
    fixture.prompt({
      agentTeamMode: "team",
      workspaceContext: { shortWorkspace: shortWorkspace() },
      ...payload
    });
  return { ...fixture, prompt, resolveWebSearch };
}

describe("session prompt web search", () => {
  it("hands the settings Main resolved to the Agent when the user switched search on", async () => {
    const { ctx, prompt, internalPayload } = promptFixture(
      async () => searchSettings
    );
    await expect(
      handleSessionCommands(ctx, prompt({ webSearchEnabled: true }))
    ).resolves.toMatchObject({ status: "accepted" });
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(internalPayload().webSearchEnabled).toBe(true);
  });

  it("does not even read the settings while the switch is off", async () => {
    const resolve = vi.fn(async () => searchSettings);
    const { ctx, prompt, internalPayload } = promptFixture(resolve);
    await handleSessionCommands(ctx, prompt());
    await handleSessionCommands(ctx, prompt({ webSearchEnabled: false }));
    expect(resolve).not.toHaveBeenCalled();
    expect(internalPayload()).not.toHaveProperty("webSearch");
  });

  it("sends no search settings while search is off, unconfigured or unavailable", async () => {
    for (const resolve of [async () => undefined, undefined]) {
      const { ctx, prompt, internalPayload } = promptFixture(resolve);
      await handleSessionCommands(ctx, prompt({ webSearchEnabled: true }));
      expect(internalPayload()).not.toHaveProperty("webSearch");
    }
  });

  it("reads the settings for an always-on team member while the main switch is off", async () => {
    const { ctx, prompt, internalPayload, resolveWebSearch } =
      teamFixture("on");
    await expect(handleSessionCommands(ctx, prompt())).resolves.toMatchObject({
      status: "accepted"
    });
    expect(resolveWebSearch).toHaveBeenCalledTimes(1);
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(internalPayload()).not.toHaveProperty("webSearchEnabled");
  });

  it.each(["inherit", "off", undefined] as const)(
    "reads nothing for a team member in %s mode while the main switch is off",
    async (mode) => {
      const { ctx, prompt, internalPayload, resolveWebSearch } =
        teamFixture(mode);
      await handleSessionCommands(ctx, prompt());
      expect(resolveWebSearch).not.toHaveBeenCalled();
      expect(internalPayload()).not.toHaveProperty("webSearch");
    }
  );

  it("still reads the settings for a following member when the main switch is on", async () => {
    const { ctx, prompt, internalPayload } = teamFixture("inherit");
    await handleSessionCommands(ctx, prompt({ webSearchEnabled: true }));
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(internalPayload().webSearchEnabled).toBe(true);
  });

  it("never lets the Renderer choose the settings or a key", async () => {
    const { ctx, prompt, internalPayload } = promptFixture(
      async () => searchSettings
    );
    const forged = {
      ...searchSettings,
      apiKey: "invalid-forged-key",
      baseUrl: "https://evil.example.test"
    };
    await handleSessionCommands(
      ctx,
      prompt({ webSearch: forged, webSearchEnabled: true })
    );
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(JSON.stringify(internalPayload())).not.toContain(
      "invalid-forged-key"
    );
  });
});
