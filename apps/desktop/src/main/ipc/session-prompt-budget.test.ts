import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createDefaultGeneralSettings,
  createEnvelope
} from "@deepwrite/contracts";
import { handleSessionCommands } from "./session-commands";
import type { IpcCommandContext } from "./command-types";

describe("authoritative workspace prompt budget", () => {
  it("rechecks the saved budget before dispatch and accepts the unchanged input after an increase", async () => {
    const settings = createDefaultGeneralSettings();
    settings.contextCompaction.budgetTokens = 64_000;
    const requestCommand = vi.fn(async (_worker, command) => ({
      status: "accepted" as const,
      requestId: command.id,
      payload: {
        sessionId: "session-budget",
        runId: "run-budget",
        acceptedAt: "2026-10-17T00:00:00.000Z",
        runtime: { provider: "example", model: "fixture", mode: "local-faux" }
      }
    }));
    const ctx = {
      activeRuns: new Map(),
      terminalRuns: new Set(),
      pendingUsageContexts: new Map(),
      supervisor: { requestCommand },
      requireModelConfigStore: () => ({ resolve: async () => undefined }),
      requireWorkspaceAgentConfigStore: () => ({}),
      requireLongAgentConfigStore: () => ({}),
      requireAcademicAgentConfigStore: () => ({}),
      requireAgentTeamConfigStore: () => ({}),
      requireLibraryAgentConfigStore: () => ({}),
      requireGeneralSettingsStore: () => ({ list: async () => ({ settings }) })
    } as unknown as IpcCommandContext;
    const message = "字".repeat(60_000);
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "session.prompt",
        {
          sessionId: "session-budget",
          message
        },
        { id: "prompt-budget", context: { sessionId: "session-budget" } }
      )
    );

    expect(await handleSessionCommands(ctx, command)).toMatchObject({
      status: "rejected",
      error: {
        code: "session.prompt_budget_exceeded",
        details: {
          budgetTokens: 64_000,
          maxInputTokens: 57_600,
          inputTokens: 60_000
        }
      }
    });
    expect(requestCommand).not.toHaveBeenCalled();
    expect(ctx.pendingUsageContexts.size).toBe(0);

    settings.contextCompaction.budgetTokens = 128_000;
    expect(await handleSessionCommands(ctx, command)).toMatchObject({
      status: "accepted"
    });
    expect(requestCommand).toHaveBeenCalledOnce();
    expect(requestCommand.mock.lastCall?.[1]).toMatchObject({
      type: "agent.prompt",
      payload: {
        message,
        contextCompactionSettings: { budgetTokens: 128_000 }
      }
    });
  });
});
