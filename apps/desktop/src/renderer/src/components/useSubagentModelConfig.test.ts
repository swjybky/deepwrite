import { describe, expect, it } from "vitest";
import type {
  ModelConfig,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { useSubagentModelConfig } from "./useSubagentModelConfig";

const opus = {
  id: "model-opus",
  label: "Opus",
  provider: "anthropic",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.6, 1],
  defaultThinkingLevel: "high"
} as unknown as ModelConfig;
const sonnet = {
  id: "model-sonnet",
  label: "Sonnet",
  provider: "anthropic",
  thinkingLevelOptions: ["medium"],
  temperatureOptions: [0.3, 0.9],
  defaultThinkingLevel: "medium"
} as unknown as ModelConfig;

function subagent(
  overrides: Partial<ShortAgentSubagentDefinition> = {}
): ShortAgentSubagentDefinition {
  return {
    id: "subagent_a",
    name: "连续性审阅",
    description: "检查前后一致性",
    systemPrompt: "只核对设定。",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit",
    ...overrides
  };
}

function setup(disabled = false) {
  return useSubagentModelConfig({
    models: () => [opus, sonnet],
    disabled: () => disabled
  });
}

describe("useSubagentModelConfig", () => {
  it("lists configured models and builds reasoning options from the chosen model", () => {
    const config = setup();
    expect(config.modelOptions.value.map((option) => option.value)).toEqual([
      "model-opus",
      "model-sonnet"
    ]);
    expect(
      config
        .thinkingOptionsFor(subagent({ modelId: "model-sonnet" }))
        .map((option) => option.value)
    ).toEqual(["off", "medium"]);
    // Without a model the editor still offers every built-in level.
    expect(config.thinkingOptionsFor(subagent())[0]?.value).toBe("off");
    expect(config.thinkingOptionsFor(subagent()).length).toBeGreaterThan(2);
    expect(
      config
        .temperatureOptionsFor(subagent({ modelId: "model-opus" }))
        .map((option) => option.value)
    ).toEqual([0.2, 0.6, 1]);
  });

  it("switching to a separate model picks the first model with its defaults", () => {
    const config = setup();
    const item = subagent();
    config.setModelMode(item, "custom");
    expect(item).toMatchObject({
      modelMode: "custom",
      modelId: "model-opus",
      thinkingLevel: "high",
      temperature: 0.6
    });
  });

  it("switching back to the primary agent model drops the separate settings", () => {
    const config = setup();
    const item = subagent({
      modelMode: "custom",
      modelId: "model-opus",
      thinkingLevel: "off",
      temperature: 1
    });
    config.setModelMode(item, "inherit");
    expect(item.modelMode).toBe("inherit");
    expect(item).not.toHaveProperty("modelId");
    expect(item).not.toHaveProperty("thinkingLevel");
    expect(item).not.toHaveProperty("temperature");
  });

  it("applies the defaults of a newly selected model", () => {
    const config = setup();
    const item = subagent({ modelMode: "custom", modelId: "model-opus" });
    config.setModelId(item, "model-sonnet");
    expect(item).toMatchObject({
      modelId: "model-sonnet",
      thinkingLevel: "medium",
      temperature: 0.9
    });
  });

  it("keeps a valid temperature but repairs an invalid one when reasoning is turned off", () => {
    const config = setup();
    const valid = subagent({
      modelMode: "custom",
      modelId: "model-opus",
      thinkingLevel: "high",
      temperature: 1
    });
    config.setThinkingLevel(valid, "off");
    expect(valid).toMatchObject({ thinkingLevel: "off", temperature: 1 });

    const invalid = subagent({
      modelMode: "custom",
      modelId: "model-opus",
      thinkingLevel: "high",
      temperature: 0.45
    });
    config.setThinkingLevel(invalid, "off");
    expect(invalid.temperature).toBe(0.6);
  });

  it("ignores edits while the form is disabled", () => {
    const config = setup(true);
    const item = subagent();
    config.setModelMode(item, "custom");
    config.setModelId(item, "model-sonnet");
    config.setThinkingLevel(item, "off");
    config.setTemperature(item, 1);
    expect(item).toEqual(subagent());
  });

  it("summarises how the subagent picks its model", () => {
    const config = setup();
    const inherited = config.subagentModelSummary(subagent());
    const unselected = config.subagentModelSummary(
      subagent({ modelMode: "custom" })
    );
    const high = config.subagentModelSummary(
      subagent({
        modelMode: "custom",
        modelId: "model-opus",
        thinkingLevel: "high"
      })
    );
    const off = config.subagentModelSummary(
      subagent({
        modelMode: "custom",
        modelId: "model-opus",
        thinkingLevel: "off",
        temperature: 0.6
      })
    );
    expect(new Set([inherited, unselected, high, off]).size).toBe(4);
    expect(high).toContain("Opus");
    expect(off).toContain("Opus");
    expect(off).toContain("0.6");
  });
});
