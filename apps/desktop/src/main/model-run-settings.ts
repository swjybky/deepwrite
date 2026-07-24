import type {
  AgentProviderRuntimeConfig,
  ThinkingLevel
} from "@deepwrite/contracts";

export interface RequestedModelRunSettings {
  thinkingLevel?: ThinkingLevel | undefined;
  temperature?: number | undefined;
}

export interface EffectiveModelRunSettings {
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
}

/**
 * Resolves per-run generation settings without treating the model editor's
 * reasoning/temperature selection as a permanent capability restriction.
 */
export function resolveModelRunSettings(
  runtimeConfig: AgentProviderRuntimeConfig | undefined,
  requested: RequestedModelRunSettings
): EffectiveModelRunSettings {
  if (
    runtimeConfig &&
    requested.thinkingLevel !== undefined &&
    requested.thinkingLevel !== "off" &&
    !runtimeConfig.thinkingLevelOptions.includes(requested.thinkingLevel)
  ) {
    throw new Error("所选思考等级不在当前模型配置中，请重新选择。");
  }

  const thinkingLevel = requested.thinkingLevel ?? runtimeConfig?.defaultThinkingLevel;
  if (
    runtimeConfig &&
    thinkingLevel === "off" &&
    requested.temperature !== undefined &&
    !runtimeConfig.temperatureOptions.includes(requested.temperature)
  ) {
    throw new Error("所选温度不在当前模型配置中，请重新选择。");
  }

  const temperature = runtimeConfig && thinkingLevel === "off"
    ? requested.temperature ?? runtimeConfig.temperatureOptions[1]
    : undefined;

  return {
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(temperature !== undefined ? { temperature } : {})
  };
}

/**
 * Validates requested thinking/temperature against a resolved model config.
 * Use when callers apply those settings later (e.g. subagent spawn) and only
 * need the throw-on-invalid behavior here.
 */
export function assertModelRunSettings(
  runtimeConfig: AgentProviderRuntimeConfig | undefined,
  requested: RequestedModelRunSettings
): void {
  resolveModelRunSettings(runtimeConfig, requested);
}
