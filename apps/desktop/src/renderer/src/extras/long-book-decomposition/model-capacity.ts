import { shallowRef } from "vue";
import type {
  DeepWriteApi,
  ModelCapacityResult,
  ModelConfig,
  ModelConfigInput
} from "@deepwrite/contracts/renderer";
import { jsonClone } from "@deepwrite/shared";

function capacityInput(model: ModelConfig): ModelConfigInput {
  const { hasApiKey: _hasApiKey, ...identity } = model;
  return jsonClone(identity);
}

/** Capacity resolution reads the existing runtime catalog; it never calls a model. */
export function createDecompositionModelCapacities(api: () => DeepWriteApi) {
  const resolved = shallowRef(new Map<string, ModelCapacityResult>());
  const pending = new Map<string, Promise<ModelCapacityResult>>();
  let disposed = false;
  function peek(model: ModelConfig) {
    if (model.contextWindow && model.maxTokens)
      return {
        modelId: model.id,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens
      };
    return resolved.value.get(JSON.stringify(capacityInput(model)));
  }
  async function resolve(model: ModelConfig): Promise<ModelCapacityResult> {
    const known = peek(model);
    if (known) return known;
    const input = capacityInput(model);
    const key = JSON.stringify(input);
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const request = api()
      .models.resolveCapacity(input)
      .then((capacity) => {
        if (!disposed)
          resolved.value = new Map(resolved.value).set(key, capacity);
        return capacity;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }
  return {
    peek,
    resolve,
    dispose() {
      disposed = true;
      pending.clear();
    }
  };
}
