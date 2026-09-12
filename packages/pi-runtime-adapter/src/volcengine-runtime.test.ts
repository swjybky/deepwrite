import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";

function configFor(provider: string): AgentProviderRuntimeConfig {
  return {
    id: "ark-writer",
    label: "Ark writer",
    provider,
    modelId:
      provider === "volcengine-plan"
        ? "ark-code-latest"
        : "doubao-seed-2-0-pro-260215",
    api: "openai-completions",
    baseUrl:
      provider === "volcengine-plan"
        ? "https://ark.example.test/api/coding/v3"
        : "https://ark.example.test/api/v3",
    apiKey: "invalid-test-key",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.2, 0.6, 1.2]
  };
}

async function capturePayload(
  config: AgentProviderRuntimeConfig,
  thinking: "off" | "medium"
): Promise<Record<string, unknown>> {
  const { model, streamFn } = buildProviderRuntime(
    config,
    thinking === "off" ? 0.6 : undefined,
    thinking
  );
  let captured: unknown;
  const stream = await streamFn(
    model,
    {
      systemPrompt: "Help with writing.",
      messages: [{ role: "user", content: "Read my draft.", timestamp: 0 }],
      tools: [
        {
          name: "read_draft",
          description: "Read a draft",
          parameters: Type.Object({ id: Type.String() })
        }
      ]
    },
    {
      ...(thinking === "medium" ? { reasoning: thinking } : {}),
      onPayload: (payload) => {
        captured = payload;
        throw new Error("Stop before sending a request");
      }
    }
  );
  await stream.result();
  expect(captured).toBeDefined();
  return captured as Record<string, unknown>;
}

describe.each(["volcengine", "volcengine-plan"])("%s runtime", (provider) => {
  it("uses Ark's thinking and token fields with system prompts and tools", async () => {
    const config = configFor(provider);
    const payload = await capturePayload(config, "medium");

    expect(payload).toMatchObject({
      model: config.modelId,
      thinking: { type: "enabled" },
      reasoning_effort: "medium",
      max_tokens: expect.any(Number),
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Help with writing." },
        { role: "user", content: "Read my draft." }
      ],
      tools: [{ type: "function", function: { name: "read_draft" } }]
    });
    expect(payload).not.toHaveProperty("store");
    expect(payload).not.toHaveProperty("max_completion_tokens");
    expect(payload.tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ strict: true })
        })
      ])
    );
  });

  it("disables thinking when the user selects temperature mode", async () => {
    const payload = await capturePayload(
      { ...configFor(provider), reasoning: false, defaultThinkingLevel: "off" },
      "off"
    );

    expect(payload).toMatchObject({
      thinking: { type: "disabled" },
      temperature: 0.6
    });
    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("preserves the configured endpoint, request model ID and role override", () => {
    const config = {
      ...configFor(provider),
      requestModelId: "ep-test-endpoint",
      supportsDeveloperRole: true
    };
    const { model } = buildProviderRuntime(config);

    expect(model).toMatchObject({
      id: "ep-test-endpoint",
      baseUrl: config.baseUrl,
      provider,
      compat: { supportsDeveloperRole: true }
    });
  });
});

describe("Ark Coding Plan capacities", () => {
  it("keeps the routing alias within its published output limit", async () => {
    const payload = await capturePayload(
      configFor("volcengine-plan"),
      "medium"
    );
    expect(payload.max_tokens).toBe(32_000);
  });

  it("uses Seed 2 capacities while retaining user overrides", () => {
    const config = {
      ...configFor("volcengine-plan"),
      modelId: "doubao-seed-2.0-pro"
    };
    expect(buildProviderRuntime(config).model).toMatchObject({
      contextWindow: 256_000,
      maxTokens: 128_000
    });
    expect(
      buildProviderRuntime({
        ...config,
        contextWindow: 64_000,
        maxTokens: 8_000
      }).model
    ).toMatchObject({ contextWindow: 64_000, maxTokens: 8_000 });
  });

  it("does not apply Coding Plan metadata or serialization to other providers", () => {
    const config = { ...configFor("custom"), modelId: "ark-code-latest" };
    expect(buildProviderRuntime(config).model).not.toHaveProperty("compat");
    expect(() => buildProviderRuntime({ ...config, baseUrl: "" })).toThrow(
      "请填写 API 地址"
    );
  });
});
