import { describe, expect, it, vi } from "vitest";
import { CommandEnvelopeSchema, createEnvelope } from "@deepwrite/contracts";
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

describe("session prompt web search", () => {
  it("rejects workspace web search for an incompatible model", async () => {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "session.prompt",
        {
          sessionId: "session_workspace_search",
          message: "查一下近期同类题材",
          modelId: "writer",
          webSearchEnabled: true
        },
        {
          id: "command_workspace_search",
          context: { sessionId: "session_workspace_search" }
        }
      )
    );
    const ctx = {
      pendingUsageContexts: new Map(),
      activeRuns: new Map(),
      requireModelConfigStore: () => ({
        resolve: vi.fn(async () => ({
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "medium",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.1, 0.7, 1]
        }))
      })
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: {
        message: expect.stringMatching(/智能搜索仅支持/u)
      }
    });
  });
});
