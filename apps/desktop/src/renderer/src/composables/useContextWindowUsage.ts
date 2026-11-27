import { computed, onScopeDispose, ref, watch } from "vue";
import type {
  ModelCapacityResult,
  ModelConfig,
  ModelConfigInput
} from "@deepwrite/contracts";
import type { ChatMessage } from "../types/conversation";
import {
  createContextWindowMeasurement,
  latestModelContextTokens
} from "../utils/contextWindowUsage";
import { deepwriteApi } from "../api/deepwrite";

export type ContextWindowCapacityStatus =
  "idle" | "resolving" | "resolved" | "unavailable";

interface UseContextWindowUsageOptions {
  messages: () => readonly ChatMessage[];
  selectedModel: () => ModelConfig | undefined;
  resolveCapacity?: (model: ModelConfigInput) => Promise<ModelCapacityResult>;
}

function capacityKey(model: ModelConfig | undefined): string {
  if (!model) return "";
  return [
    model.id,
    model.provider,
    model.modelId,
    model.requestModelId ?? "",
    model.api,
    model.baseUrl,
    model.contextWindow ?? "",
    model.maxTokens ?? ""
  ].join("\u0000");
}

function toCapacityModelInput(model: ModelConfig): ModelConfigInput {
  const { hasApiKey, ...identity } = model;
  void hasApiKey;
  return {
    ...identity,
    thinkingLevelOptions: [...model.thinkingLevelOptions],
    temperatureOptions: [
      model.temperatureOptions[0],
      model.temperatureOptions[1],
      model.temperatureOptions[2]
    ]
  };
}

function defaultCapacityResolver(
  model: ModelConfigInput
): Promise<ModelCapacityResult> {
  const api = deepwriteApi()?.models;
  if (!api) return Promise.reject(new Error("Model API is unavailable."));
  return api.resolveCapacity(model);
}

export function useContextWindowUsage(options: UseContextWindowUsageOptions) {
  const contextWindow = ref<number>();
  const capacityStatus = ref<ContextWindowCapacityStatus>("idle");
  let resolveSequence = 0;

  const usedTokens = computed(() =>
    latestModelContextTokens(options.messages(), options.selectedModel())
  );
  const measurement = computed(() =>
    createContextWindowMeasurement(usedTokens.value, contextWindow.value)
  );

  async function resolveSelectedModelCapacity(): Promise<void> {
    const sequence = ++resolveSequence;
    const model = options.selectedModel();
    contextWindow.value = undefined;

    if (!model) {
      capacityStatus.value = "idle";
      return;
    }
    if (model.contextWindow !== undefined) {
      contextWindow.value = model.contextWindow;
      capacityStatus.value = "resolved";
      return;
    }

    capacityStatus.value = "resolving";
    try {
      const result = await (options.resolveCapacity ?? defaultCapacityResolver)(
        toCapacityModelInput(model)
      );
      if (sequence !== resolveSequence) return;
      if (
        !Number.isInteger(result.contextWindow) ||
        result.contextWindow <= 0
      ) {
        capacityStatus.value = "unavailable";
        return;
      }
      contextWindow.value = result.contextWindow;
      capacityStatus.value = "resolved";
    } catch {
      if (sequence !== resolveSequence) return;
      capacityStatus.value = "unavailable";
    }
  }

  watch(
    () => capacityKey(options.selectedModel()),
    () => {
      void resolveSelectedModelCapacity();
    },
    { immediate: true }
  );

  onScopeDispose(() => {
    resolveSequence += 1;
  });

  return {
    capacityStatus,
    contextWindow,
    measurement,
    usedTokens
  };
}
