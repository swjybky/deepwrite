import type { AgentProviderRuntimeConfig } from "./index.test-support";
import {
  captureDisabledThinkingPayload,
  captureThinkingPayload,
  describe,
  expect,
  it
} from "./index.test-support";
import { applyGoogleClaudeThinkingCompatibility } from "./google-claude-thinking";

function googleClaudeConfig(modelId: string): AgentProviderRuntimeConfig {
  return {
    id: `google-${modelId}`,
    label: modelId,
    provider: "google",
    modelId,
    api: "google-generative-ai",
    baseUrl: "https://gateway.example.test/gemini/v1beta",
    reasoning: true,
    defaultThinkingLevel: "max",
    thinkingLevelOptions: ["low", "high", "max"],
    temperatureOptions: [0.7, 1, 1.5],
    apiKey: "test-only",
    contextWindow: 250_000,
    maxTokens: 65_535
  };
}

describe("Google-compatible Claude thinking", () => {
  it.each([
    ["claude-opus-4-6-thinking", "low", 2_048],
    ["claude-opus-4-6-thinking", "high", 16_384],
    ["claude-opus-4-6-thinking", "max", 32_768],
    ["claude-sonnet-4-6", "low", 2_048],
    ["claude-sonnet-4-6", "high", 16_384],
    ["claude-sonnet-4-6", "max", 32_768]
  ] as const)(
    "serializes %s at %s with a positive thinking budget",
    async (modelId, level, expectedBudget) => {
      await expect(
        captureThinkingPayload(googleClaudeConfig(modelId), level)
      ).resolves.toMatchObject({
        model: modelId,
        config: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: expectedBudget
          }
        }
      });
    }
  );

  it("still disables Claude thinking when the run selects off", async () => {
    await expect(
      captureDisabledThinkingPayload(
        googleClaudeConfig("claude-opus-4-6-thinking")
      )
    ).resolves.toMatchObject({
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
  });

  it("does not change unknown non-Claude Google models", async () => {
    await expect(
      captureThinkingPayload(googleClaudeConfig("writer-model"), "high")
    ).resolves.toMatchObject({
      config: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }
      }
    });
  });

  it("raises a tiny output cap above the selected Claude thinking budget", () => {
    expect(
      applyGoogleClaudeThinkingCompatibility(
        "google-generative-ai",
        "claude-opus-4-6-thinking",
        { reasoning: "xhigh", maxTokens: 8 }
      )
    ).toMatchObject({
      reasoning: "high",
      maxTokens: 32_769,
      thinkingBudgets: { high: 32_768 }
    });
  });
});
