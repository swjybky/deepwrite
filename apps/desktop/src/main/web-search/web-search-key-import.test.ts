import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_HOST,
  FIXED_NOW,
  OTHER_SEARCH_KEY,
  SEARCH_KEY,
  deepSeekModel,
  settingsInput,
  setup
} from "./web-search-test-support";

const models = [
  deepSeekModel("m_chat", SEARCH_KEY),
  deepSeekModel("m_reasoner", SEARCH_KEY, {
    baseUrl: `https://${DEEPSEEK_HOST}/anthropic`
  }),
  deepSeekModel("m_work", OTHER_SEARCH_KEY),
  deepSeekModel("m_relay", "invalid-test-relay-key", {
    baseUrl: "https://relay.example.test/v1"
  }),
  deepSeekModel("m_nokey", "", { hasApiKey: false }),
  deepSeekModel("m_free", "invalid-test-free-key", {
    managedBy: "deepwrite-free"
  }),
  deepSeekModel("m_other", "invalid-test-other-key", { provider: "openai" })
];

describe("web search key import candidates", () => {
  it("offers nothing when no DeepSeek model holds a key", async () => {
    const { service } = await setup({ models: [models[3]!, models[4]!] });
    expect(await service.listKeyImportCandidates("deepseek")).toEqual({
      candidates: [],
      hasCurrentKey: false
    });
  });

  it("groups models by key and never exposes the key", async () => {
    const { service } = await setup({ models });
    const result = await service.listKeyImportCandidates("deepseek");
    expect(result.candidates).toEqual([
      {
        sourceModelId: "m_chat",
        keyHint: "…-key",
        models: [
          { id: "m_chat", label: "模型 m_chat" },
          { id: "m_reasoner", label: "模型 m_reasoner" }
        ],
        matchesCurrentKey: false
      },
      {
        sourceModelId: "m_work",
        keyHint: "…-key",
        models: [{ id: "m_work", label: "模型 m_work" }],
        matchesCurrentKey: false
      }
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toContain(SEARCH_KEY);
    expect(text).not.toContain(OTHER_SEARCH_KEY);
  });

  it("gives no hint for a short key", async () => {
    const { service } = await setup({
      models: [deepSeekModel("m_a", "k-123")]
    });
    const result = await service.listKeyImportCandidates("deepseek");
    expect(result.candidates[0]!.keyHint).toBe("");
  });

  it("marks the candidate whose key is already in use", async () => {
    const { service } = await setup({ models });
    await service.saveSettings(
      settingsInput({
        profiles: [
          { providerId: "deepseek", maxResults: 8, apiKey: OTHER_SEARCH_KEY }
        ]
      })
    );
    const result = await service.listKeyImportCandidates("deepseek");
    expect(result.hasCurrentKey).toBe(true);
    expect(
      result.candidates.map(({ sourceModelId, matchesCurrentKey }) => [
        sourceModelId,
        matchesCurrentKey
      ])
    ).toEqual([
      ["m_chat", false],
      ["m_work", true]
    ]);
  });
});

describe("web search key import", () => {
  it("copies the key, records its source and turns search on", async () => {
    const { service, keySources } = await setup({ models });
    await service.saveSettings(
      settingsInput({
        enabled: false,
        perRunCallLimit: 7,
        profiles: [{ providerId: "deepseek", maxResults: 4, clearApiKey: true }]
      })
    );
    const imported = await service.importKey({
      providerId: "deepseek",
      sourceModelId: "m_chat"
    });
    expect(imported).toMatchObject({
      enabled: true,
      activeProviderId: "deepseek",
      perRunCallLimit: 7,
      profiles: expect.arrayContaining([
        expect.objectContaining({
          providerId: "deepseek",
          maxResults: 4,
          hasApiKey: true,
          keySource: {
            kind: "model",
            modelId: "m_chat",
            modelLabel: "模型 m_chat",
            importedAt: new Date(FIXED_NOW).toISOString()
          }
        })
      ])
    });
    expect(JSON.stringify(imported)).not.toContain(SEARCH_KEY);

    // A copy: removing or changing the source model leaves search working.
    keySources.state.models = [];
    expect((await service.resolveRuntime())?.apiKey).toBe(SEARCH_KEY);
  });

  it("replaces a manually saved key and its source", async () => {
    const { service } = await setup({ models });
    await service.saveSettings(settingsInput());
    const imported = await service.importKey({
      providerId: "deepseek",
      sourceModelId: "m_work"
    });
    expect(imported.profiles[0]!.keySource).toMatchObject({
      kind: "model",
      modelId: "m_work"
    });
    expect((await service.resolveRuntime())?.apiKey).toBe(OTHER_SEARCH_KEY);
  });

  it("refuses a model that no longer qualifies", async () => {
    const { service, keySources } = await setup({ models });
    const stale = { providerId: "deepseek", sourceModelId: "m_chat" } as const;
    keySources.state.models = models.filter((model) => model.id !== "m_chat");
    await expect(service.importKey(stale)).rejects.toThrow(
      "所选模型已不符合导入条件"
    );
    for (const sourceModelId of ["m_relay", "m_free", "m_other", "m_nokey"]) {
      await expect(
        service.importKey({ providerId: "deepseek", sourceModelId })
      ).rejects.toThrow("所选模型已不符合导入条件");
    }
    expect((await service.getSettings()).profiles[0]!.hasApiKey).toBe(false);
  });
});
