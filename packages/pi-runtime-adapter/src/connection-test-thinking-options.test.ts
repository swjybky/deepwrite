import type {
  AgentProviderRuntimeConfig,
  ThinkingLevel
} from "@deepwrite/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const streamFn = vi.fn(
    async (
      _model: unknown,
      _context: unknown,
      _options?: Record<string, unknown>
    ) => ({
      result: async () => ({ stopReason: "stop" })
    })
  );
  return {
    streamFn,
    buildProviderRuntime: vi.fn(() => ({
      model: { contextWindow: 272_000, maxTokens: 128_000 },
      streamFn
    }))
  };
});

vi.mock("./provider-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-runtime")>()),
  buildProviderRuntime: runtimeMocks.buildProviderRuntime
}));

import { PiAgentRuntimeAdapter } from "./adapter";

function runtimeConfig(
  defaultThinkingLevel: ThinkingLevel
): AgentProviderRuntimeConfig {
  return {
    id: `connection-${defaultThinkingLevel}`,
    label: `Connection ${defaultThinkingLevel}`,
    provider: "custom",
    modelId: "custom-model",
    api: "openai-completions",
    baseUrl: "https://provider.example.test/v1",
    reasoning: defaultThinkingLevel !== "off",
    defaultThinkingLevel,
    thinkingLevelOptions: ["low", "max", "ultra"],
    temperatureOptions: [0.2, 0.6, 1.1],
    apiKey: "invalid-test-key"
  };
}

describe("PiAgentRuntimeAdapter connection-test thinking options", () => {
  beforeEach(() => {
    runtimeMocks.buildProviderRuntime.mockClear();
    runtimeMocks.streamFn.mockClear();
  });

  it("returns the resolved model capacity after a successful connection test", async () => {
    const result = await new PiAgentRuntimeAdapter().testConnection(
      runtimeConfig("off")
    );

    expect(result).toMatchObject({
      ok: true,
      modelId: "connection-off",
      contextWindow: 272_000,
      maxTokens: 128_000
    });
  });

  it("uses the configured off level and its neutral temperature without a reasoning override", async () => {
    const config = runtimeConfig("off");

    await new PiAgentRuntimeAdapter().testConnection(config);

    expect(runtimeMocks.buildProviderRuntime).toHaveBeenCalledWith(
      config,
      0.6,
      "off",
      { onDeveloperRoleFallback: expect.any(Function) }
    );
    expect(runtimeMocks.streamFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        apiKey: "invalid-test-key",
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: 15_000
      })
    );
    expect(runtimeMocks.streamFn.mock.calls[0]?.[2]).not.toHaveProperty(
      "reasoning"
    );
  });

  it.each([
    ["low", "low"],
    ["ultra", "xhigh"],
    ["max", "xhigh"]
  ] as const)(
    "carries the configured %s level through Pi's %s stream option",
    async (configuredLevel, carrier) => {
      const config = runtimeConfig(configuredLevel);

      await new PiAgentRuntimeAdapter().testConnection(config);

      expect(runtimeMocks.buildProviderRuntime).toHaveBeenCalledWith(
        config,
        undefined,
        configuredLevel,
        { onDeveloperRoleFallback: expect.any(Function) }
      );
      expect(runtimeMocks.streamFn.mock.calls[0]?.[2]).toMatchObject({
        reasoning: carrier,
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: 15_000
      });
    }
  );
});
