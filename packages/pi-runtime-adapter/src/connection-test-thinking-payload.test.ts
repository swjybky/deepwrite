import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import { PiAgentRuntimeAdapter } from "./adapter";

function runtimeConfig(
  overrides: Partial<AgentProviderRuntimeConfig>
): AgentProviderRuntimeConfig {
  return {
    id: "connection-model",
    label: "Connection model",
    provider: "deepseek",
    modelId: "deepseek-chat",
    api: "openai-completions",
    baseUrl: "https://provider.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low", "high", "max"],
    temperatureOptions: [0.2, 0.6, 1.1],
    apiKey: "invalid-test-key",
    ...overrides
  };
}

async function captureConnectionTestPayload(
  config: AgentProviderRuntimeConfig
): Promise<Record<string, unknown>> {
  let capturedPayload: Record<string, unknown> | undefined;
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const body =
      init?.body ??
      (input instanceof Request ? await input.clone().text() : "");
    capturedPayload = JSON.parse(String(body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ error: { message: "expected connection-test stop" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  };
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(
      new PiAgentRuntimeAdapter().testConnection(config)
    ).rejects.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
  if (!capturedPayload) {
    throw new Error("Connection-test payload was not captured.");
  }
  return capturedPayload;
}

describe("PiAgentRuntimeAdapter connection-test thinking payload", () => {
  it("serializes an explicit off default with its neutral temperature", async () => {
    const payload = await captureConnectionTestPayload(runtimeConfig({}));

    expect(payload).toMatchObject({
      model: "deepseek-chat",
      thinking: { type: "disabled" },
      temperature: 0.6
    });
  });

  it("keeps mandatory Z.AI thinking enabled when a stale config defaults to off", async () => {
    const payload = await captureConnectionTestPayload(
      runtimeConfig({
        provider: "zai",
        modelId: "glm-5.3",
        reasoning: false,
        defaultThinkingLevel: "off"
      })
    );

    expect(payload).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low"
    });
    expect(payload).not.toHaveProperty("temperature");
  });

  it.each([
    ["low", "glm-5.3", "zai", "openai-completions", "low"],
    ["ultra", "gpt-5.6-sol", "openai", "openai-responses", "ultra"],
    ["max", "gpt-5.6-luna", "openai", "openai-responses", "max"]
  ] as const)(
    "serializes the model-specific %s default instead of Pi's implicit default",
    async (defaultThinkingLevel, modelId, provider, api, expectedEffort) => {
      const payload = await captureConnectionTestPayload(
        runtimeConfig({
          provider,
          modelId,
          api,
          reasoning: true,
          defaultThinkingLevel,
          thinkingLevelOptions: ["low", "max", "ultra"]
        })
      );

      if (api === "openai-responses") {
        expect(payload).toMatchObject({
          model: modelId,
          reasoning: { effort: expectedEffort }
        });
      } else {
        expect(payload).toMatchObject({
          model: modelId,
          thinking: { type: "enabled" },
          reasoning_effort: expectedEffort
        });
      }
      expect(payload).not.toHaveProperty("temperature");
    }
  );

  it("keeps Google Claude connection-test output above its thinking budget", async () => {
    const payload = await captureConnectionTestPayload(
      runtimeConfig({
        provider: "google",
        modelId: "claude-opus-4-6-thinking",
        api: "google-generative-ai",
        baseUrl: "https://provider.example.test/gemini/v1beta",
        reasoning: true,
        defaultThinkingLevel: "max",
        thinkingLevelOptions: ["low", "high", "max"],
        maxTokens: 65_535
      })
    );

    expect(payload).toMatchObject({
      generationConfig: {
        maxOutputTokens: 32_769,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 32_768
        }
      }
    });
  });
});
