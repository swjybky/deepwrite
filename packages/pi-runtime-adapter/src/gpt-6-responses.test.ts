import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";
import { buildShortWorkspaceTools } from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

function modelConfig(
  provider = "openai",
  modelId = "gpt-6-astra"
): AgentProviderRuntimeConfig {
  return {
    id: "gpt-6-test",
    label: "GPT-6 test",
    provider,
    modelId,
    api: "openai-responses",
    baseUrl: "https://models.example.test/v1",
    apiKey: "invalid-test-key",
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.2, 0.7, 1.2]
  };
}

describe("GPT-6 Responses compatibility", () => {
  it.each([
    ["openai", "gpt-6-astra"],
    ["custom", "gpt-6-astra"],
    ["custom", "gpt-6-astra-routed"],
    ["custom", "gateway-gpt-6-astra"]
  ])("keeps read arguments optional for %s/%s", async (provider, modelId) => {
    const read = toolByName(
      buildShortWorkspaceTools({
        workspace: shortWorkspace(),
        profile: shortProfile()
      }),
      "read"
    );
    const originalParameters = structuredClone(read.parameters);
    const { model, streamFn } = buildProviderRuntime(
      modelConfig(provider, modelId)
    );
    let payload: unknown;
    const stream = await streamFn(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Read the character overview.",
            timestamp: 0
          }
        ],
        tools: [read]
      },
      {
        reasoning: "high",
        onPayload(value) {
          payload = value;
          throw new Error("Test captured payload before network request.");
        }
      }
    );
    await stream.result();

    expect(payload).toMatchObject({
      model: modelId,
      tools: [
        {
          name: "read",
          strict: false,
          parameters: { required: ["kind", "id"] }
        }
      ],
      reasoning: { effort: "high" }
    });
    expect(read.parameters).toEqual(originalParameters);
    expect(
      resultText(
        await read.execute("read-overview", {
          kind: "character_overview",
          id: "character_design"
        })
      )
    ).toContain("kind: character_overview");
    await expect(
      read.execute("invalid-overview", {
        kind: "character_overview",
        id: "character_design",
        include_all_sections: true
      })
    ).rejects.toThrow("include_all_sections 仅用于 kind=draft、id=draft。");
  });

  it("uses upstream capacity and reasoning metadata while preserving overrides", () => {
    const config = modelConfig("custom");
    expect(buildProviderRuntime(config).model).toMatchObject({
      contextWindow: 272_000,
      maxTokens: 128_000,
      input: ["text", "image"],
      compat: { supportsStrictMode: true },
      thinkingLevelMap: { off: null, minimal: null, max: "max" }
    });
    expect(
      buildProviderRuntime({
        ...config,
        contextWindow: 500_000,
        maxTokens: 64_000
      }).model
    ).toMatchObject({ contextWindow: 500_000, maxTokens: 64_000 });
  });
});
