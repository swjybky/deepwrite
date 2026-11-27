import { describe, expect, it } from "vitest";
import {
  applyProviderPresetDefaults,
  MODEL_PROVIDER_OPTIONS
} from "./modelProviderPresets";

function providerPresetTarget(): Parameters<
  typeof applyProviderPresetDefaults
>[0] {
  return {
    provider: "custom",
    api: "openai-completions",
    baseUrl: "https://example.test/v1"
  };
}

function providerLabel(provider: string): string | undefined {
  return MODEL_PROVIDER_OPTIONS.find((option) => option.value === provider)
    ?.label;
}

describe("ModelSettingsFeature provider presets", () => {
  it("offers Kimi Coding with its Anthropic-compatible API endpoint", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "kimi-coding");

    expect(providerLabel("kimi-coding")).toBe("Kimi Coding");
    expect(target.api).toBe("anthropic-messages");
    expect(new URL(target.baseUrl).protocol).toBe("https:");
  });

  it("offers Ollama with its local OpenAI-compatible endpoint", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "ollama");

    expect(providerLabel("ollama")).toBe("Ollama");
    expect(target.api).toBe("openai-completions");
    expect(new URL(target.baseUrl).hostname).toBe("127.0.0.1");
  });

  it("defaults Xiaomi MiMo TokenPlan CN to the Responses API", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "xiaomi-token-plan-cn");

    expect(providerLabel("xiaomi-token-plan-cn")).toBe(
      "小米 MiMo TokenPlan（国内）"
    );
    expect(target.provider).toBe("xiaomi-token-plan-cn");
    expect(target.api).toBe("openai-responses");
    const presetUrl = new URL(target.baseUrl);
    expect(presetUrl.protocol).toBe("https:");
    expect(presetUrl.pathname).toBe("/v1");
  });

  it.each([
    ["minimax-codeplan", "MiniMax Plan"],
    ["dashscope", "阿里千问AI平台（百炼）"],
    ["qwen-token-plan", "阿里千问 Token Plan"],
    ["volcengine", "火山引擎（豆包）"],
    ["volcengine-plan", "火山引擎 Coding Plan"],
    ["zai-coding-cn", "智谱 Z.AI Coding Plan"],
    ["zhipu", "智谱 GLM 开放平台"],
    ["moonshot", "Kimi 开放平台"]
  ])("offers the %s OpenAI-compatible provider preset", (provider, label) => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, provider);

    expect(providerLabel(provider)).toBe(label);
    expect(target.provider).toBe(provider);
    expect(target.api).toBe("openai-completions");
    expect(new URL(target.baseUrl).protocol).toBe("https:");
  });

  it("keeps the Z.AI Coding Plan route separate from metered GLM", () => {
    const codingPlan = providerPresetTarget();
    const metered = providerPresetTarget();
    applyProviderPresetDefaults(codingPlan, "zai-coding-cn");
    applyProviderPresetDefaults(metered, "zhipu");

    expect(new URL(codingPlan.baseUrl).pathname).toBe("/api/coding/paas/v4");
    expect(new URL(metered.baseUrl).pathname).toBe("/api/paas/v4");
  });

  it("switches between metered Ark and Coding Plan without mixing their routes", () => {
    const target = providerPresetTarget();
    applyProviderPresetDefaults(target, "volcengine");
    expect(new URL(target.baseUrl).pathname).toBe("/api/v3");

    applyProviderPresetDefaults(target, "volcengine-plan");
    expect(target.provider).toBe("volcengine-plan");
    expect(new URL(target.baseUrl).pathname).toBe("/api/coding/v3");

    applyProviderPresetDefaults(target, "volcengine");
    expect(target.provider).toBe("volcengine");
    expect(new URL(target.baseUrl).pathname).toBe("/api/v3");
  });
});
