import { describe, expect, it } from "vitest";
import type { ModelConfig, ModelSettings } from "@deepwrite/contracts";
import { selectableModelSettings } from "./selectableModelSettings";

function model(id: string, enabled?: boolean): ModelConfig {
  return {
    id,
    label: id,
    provider: "example",
    modelId: id,
    api: "openai-completions",
    baseUrl: "https://models.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: true,
    ...(enabled === undefined ? {} : { enabled })
  };
}

describe("selectableModelSettings", () => {
  it("hides only disabled new-site models and repairs their default", () => {
    const disabled = model("deepwrite-site-official-example", false);
    const custom = model("custom");
    const settings: ModelSettings = {
      models: [disabled, custom],
      defaultModelId: disabled.id
    };

    expect(selectableModelSettings(settings)).toEqual({
      ...settings,
      models: [custom],
      defaultModelId: custom.id
    });
  });

  it("preserves the original snapshot when nothing is filtered", () => {
    const settings: ModelSettings = {
      models: [model("deepwrite-site-official-example", true)],
      defaultModelId: "deepwrite-site-official-example"
    };
    expect(selectableModelSettings(settings)).toBe(settings);
  });
});
