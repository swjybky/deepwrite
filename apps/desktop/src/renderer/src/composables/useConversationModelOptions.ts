import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelConfig,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { buildModelSelectOptions } from "../utils/modelSelectOptions";
import type { AgentApprovalMode } from "../types/conversation";
import type { IconName } from "../types/workspace";

const t = createScopedTranslator("workspace.conversationModelOptions");

export function useConversationModelOptions(options: {
  models: ModelConfig[];
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  approvalMode: AgentApprovalMode;
}) {
  const selectedModel = computed(() =>
    options.models.find((model) => model.id === options.selectedModelId)
  );
  const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
    get minimal() {
      return t("minimal");
    },
    get low() {
      return t("low");
    },
    get medium() {
      return t("medium");
    },
    get high() {
      return t("high");
    },
    get xhigh() {
      return t("extraHigh");
    },
    get max() {
      return t("maximum");
    }
  };
  const fallbackThinkingOptions: Array<{
    value: ThinkingLevel;
    label: string;
  }> = [
    {
      value: "off",
      get label() {
        return t("off");
      }
    },
    ...BUILT_IN_REASONING_LEVELS.map((value) => ({
      value,
      get label() {
        return builtInThinkingLabels[value];
      }
    }))
  ];

  function thinkingLabel(level: ThinkingLevel): string {
    if (level === "off") {
      return t("off");
    }
    return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
      ? builtInThinkingLabels[level as BuiltInReasoningLevel]
      : t("custom", { level: level });
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
  const modelOptions = computed(() => buildModelSelectOptions(options.models));
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
      get label() {
        return t("requestApproval");
      },
      get description() {
        return t("askForYourApprovalBeforeEditingOrWritingThe");
      }
    },
    {
      value: "auto-approve" as const,
      get label() {
        return t("approveAutomatically");
      },
      get description() {
        return t("automaticallyApproveEditsAndSaveThemToTheManuscript");
      }
    }
  ];
  const approvalModeIcon = computed<IconName>(() =>
    options.approvalMode === "request-approval" ? "user" : "check"
  );
  return {
    selectedModel,
    availableThinkingOptions,
    modelOptions,
    showsTemperature,
    temperatureSelectOptions,
    approvalOptions,
    approvalModeIcon
  };
}
