import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";

describe("PI thinking level compatibility", () => {
  it("preserves built-in thinking maps while carrying max and custom levels", () => {
    const builtinConfig: AgentProviderRuntimeConfig = {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: ""
    };

    expect(
      buildProviderRuntime(builtinConfig, undefined, "low").model
        .thinkingLevelMap
    ).toMatchObject({ low: "low", max: "max" });
    expect(
      buildProviderRuntime(builtinConfig, undefined, "xhigh").model
        .thinkingLevelMap
    ).toMatchObject({ low: "low", max: "max" });
    expect(
      buildProviderRuntime(builtinConfig, undefined, "max").model
        .thinkingLevelMap
    ).toMatchObject({ low: "low", max: "max", xhigh: "max" });

    const customConfig: AgentProviderRuntimeConfig = {
      ...builtinConfig,
      provider: "custom",
      modelId: "custom-writer",
      baseUrl: "https://ollama.example.test/v1",
      thinkingLevelOptions: [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra"
      ]
    };
    expect(
      buildProviderRuntime(customConfig, undefined, "xhigh").model
        .thinkingLevelMap
    ).toMatchObject({ xhigh: "xhigh" });
    expect(
      buildProviderRuntime(customConfig, undefined, "ultra").model
        .thinkingLevelMap
    ).toMatchObject({ xhigh: "ultra" });
  });
});
