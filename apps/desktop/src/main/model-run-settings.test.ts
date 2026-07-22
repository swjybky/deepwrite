import { describe, expect, it } from "vitest";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { resolveModelRunSettings } from "./model-run-settings";

const temperatureModeConfig: AgentProviderRuntimeConfig = {
  id: "writer",
  label: "Writer",
  provider: "custom",
  modelId: "writer-model",
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:11434/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.6, 1.2],
  apiKey: ""
};

describe("model run settings", () => {
  it("honors a requested thinking level when the model editor was left on non-thinking mode", () => {
    expect(
      resolveModelRunSettings(temperatureModeConfig, {
        thinkingLevel: "high",
        temperature: 1.2
      })
    ).toEqual({ thinkingLevel: "high" });
  });

  it("uses the configured non-thinking default and temperature when no override is requested", () => {
    expect(resolveModelRunSettings(temperatureModeConfig, {})).toEqual({
      thinkingLevel: "off",
      temperature: 0.6
    });
  });

  it("uses the requested temperature whenever thinking is turned off", () => {
    expect(
      resolveModelRunSettings(
        {
          ...temperatureModeConfig,
          reasoning: true,
          defaultThinkingLevel: "high"
        },
        { thinkingLevel: "off", temperature: 1.2 }
      )
    ).toEqual({ thinkingLevel: "off", temperature: 1.2 });
  });

  it("rejects stale run settings that are no longer configured for the model", () => {
    expect(() =>
      resolveModelRunSettings(temperatureModeConfig, { thinkingLevel: "medium" })
    ).toThrow("所选思考等级不在当前模型配置中");
    expect(() =>
      resolveModelRunSettings(temperatureModeConfig, {
        thinkingLevel: "off",
        temperature: 0.7
      })
    ).toThrow("所选温度不在当前模型配置中");
  });
});
