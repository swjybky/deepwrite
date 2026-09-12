import { computed } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelConfig,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import type { AgentApprovalMode } from "../types/conversation";
import type { IconName } from "../types/workspace";
import { isWorkspaceWebSearchAvailable } from "./agent-conversation/web-search";

export function useConversationModelOptions(options: {
  models: ModelConfig[];
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  approvalMode: AgentApprovalMode;
}) {
  const selectedModel = computed(() =>
    options.models.find((model) => model.id === options.selectedModelId)
  );
  const webSearchAvailable = computed(() =>
    isWorkspaceWebSearchAvailable(selectedModel.value)
  );
  const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
    minimal: "最低",
    low: "较低",
    medium: "标准",
    high: "深度",
    xhigh: "极高",
    max: "最高"
  };
  const fallbackThinkingOptions: Array<{
    value: ThinkingLevel;
    label: string;
  }> = [
    { value: "off", label: "关闭" },
    ...BUILT_IN_REASONING_LEVELS.map((value) => ({
      value,
      label: builtInThinkingLabels[value]
    }))
  ];

  function thinkingLabel(level: ThinkingLevel): string {
    if (level === "off") {
      return "关闭";
    }
    return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
      ? builtInThinkingLabels[level as BuiltInReasoningLevel]
      : `自定义（${level}）`;
  }

  const availableThinkingOptions = computed(() =>
    selectedModel.value
      ? [
          { value: "off" as const, label: thinkingLabel("off") },
          ...selectedModel.value.thinkingLevelOptions.map((value) => ({
            value,
            label: thinkingLabel(value)
          }))
        ]
      : fallbackThinkingOptions
  );
  const modelOptions = computed(() =>
    options.models.map((model) => ({ value: model.id, label: model.label }))
  );
  const showsTemperature = computed(
    () => Boolean(selectedModel.value) && options.thinkingLevel === "off"
  );
  const temperatureOptions = computed(
    () => selectedModel.value?.temperatureOptions ?? []
  );
  const temperatureSelectOptions = computed(() =>
    temperatureOptions.value.map((value) => ({ value, label: String(value) }))
  );
  const approvalOptions = [
    {
      value: "request-approval" as const,
      label: "请求批准",
      description: "修改或写入正文前均需你的批准"
    },
    {
      value: "auto-approve" as const,
      label: "替我审批",
      description: "自动批准修改并写入正文"
    }
  ];
  const approvalModeIcon = computed<IconName>(() =>
    options.approvalMode === "request-approval" ? "user" : "check"
  );
  return {
    selectedModel,
    webSearchAvailable,
    availableThinkingOptions,
    modelOptions,
    showsTemperature,
    temperatureSelectOptions,
    approvalOptions,
    approvalModeIcon
  };
}
