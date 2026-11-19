import { describe, expect, it } from "vitest";
import type { ModelConfig } from "@deepwrite/contracts/renderer";
import { useConversationModelOptions } from "../composables/useConversationModelOptions";
import composerSource from "./ConversationComposer.vue?raw";
import modelConfigSource from "./ConversationModelConfigSelect.vue?raw";
import modelOptionsSource from "../composables/useConversationModelOptions.ts?raw";

describe("conversation view behavior", () => {
  it("only lists configured models in the composer model selector", () => {
    const options = {
      models: [],
      selectedModelId: "",
      thinkingLevel: "off" as const,
      approvalMode: "request-approval" as const
    };
    expect(useConversationModelOptions(options).modelOptions.value).toEqual([]);
    const models = (
      [
        { id: "free", managedBy: "deepwrite-free" },
        { id: "custom-first", provider: "openai" },
        { id: "deepwrite-site-official-example", provider: "deepwrite-site" },
        { id: "custom-second", provider: "provider-b" }
      ] as const
    ).map((model): ModelConfig => ({
      label: model.id,
      modelId: model.id,
      provider: "example",
      api: "openai-completions",
      baseUrl: "https://models.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      hasApiKey: true,
      ...model
    }));
    const result = useConversationModelOptions({ ...options, models });
    expect(
      result.modelOptions.value.map(({ value, group }) => [value, group.label])
    ).toEqual([
      ["deepwrite-site-official-example", "官方小站"],
      ["custom-first", "OpenAI"],
      ["custom-second", "provider-b"],
      ["free", "免费模型"]
    ]);
    expect(composerSource).toContain(':model-options="modelOptions"');
    expect(modelConfigSource).toContain("selectModel");
    expect(`${modelOptionsSource}\n${composerSource}`).not.toContain(
      '{ value: "", label: "DeepWrite Faux" }'
    );
  });
});
