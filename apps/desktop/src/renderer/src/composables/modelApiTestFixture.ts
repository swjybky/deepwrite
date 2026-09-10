import type { DeepWriteApi } from "@deepwrite/contracts";

export function createModelApiTestFixture(): DeepWriteApi["models"] {
  return {
    async list() {
      return { models: [], defaultModelId: "" };
    },
    async refreshFree() {
      return { models: [], defaultModelId: "" };
    },
    async setFreeModelEnabled() {
      return { models: [], defaultModelId: "" };
    },
    async refreshOfficial() {
      return { models: [], defaultModelId: "" };
    },
    async queryOfficialBalance() {
      return {
        queriedAt: "2026-07-06T10:04:00.000Z",
        accountBalance: 0,
        accountBalanceYuan: 0,
        keyQuotaRemaining: 0,
        keyQuotaRemainingYuan: 0,
        quotaPerUnit: 10_000
      };
    },
    async saveOfficialToken() {
      return { models: [], defaultModelId: "" };
    },
    async clearOfficialToken() {
      return { models: [], defaultModelId: "" };
    },
    async saveSiteOfficialToken() {
      return { models: [], defaultModelId: "" };
    },
    async clearSiteOfficialToken() {
      return { models: [], defaultModelId: "" };
    },
    async refreshSiteOfficial() {
      return { models: [], defaultModelId: "" };
    },
    async querySiteOfficialQuota() {
      return {
        queriedAt: "2026-09-01T00:00:00.000Z",
        remaining: 0,
        used: 0,
        total: 0,
        unlimited: false
      };
    },
    async mergeSiteOfficialQuota() {
      return {
        transferred: "0",
        sourceRevoked: true,
        quota: {
          queriedAt: "2026-09-09T00:00:00.000Z",
          remaining: 0,
          used: 0,
          total: 0,
          unlimited: false
        }
      };
    },
    async setSiteOfficialModelEnabled() {
      return { models: [], defaultModelId: "" };
    },
    async setOfficialModelEnabled() {
      return { models: [], defaultModelId: "" };
    },
    async save(settings) {
      return {
        defaultModelId: settings.defaultModelId,
        models: settings.models.map((model) => ({
          id: model.id,
          label: model.label,
          provider: model.provider,
          modelId: model.modelId,
          api: model.api,
          baseUrl: model.baseUrl,
          reasoning: model.reasoning,
          defaultThinkingLevel: model.defaultThinkingLevel,
          thinkingLevelOptions: model.thinkingLevelOptions,
          temperatureOptions: model.temperatureOptions,
          hasApiKey: Boolean(model.apiKey)
        }))
      };
    },
    async test(model) {
      return {
        modelId: model.id,
        ok: true,
        message: "连接成功",
        testedAt: new Date().toISOString(),
        contextWindow: 272_000,
        maxTokens: 128_000
      };
    },
    async resolveCapacity(model) {
      return {
        modelId: model.id,
        contextWindow: 272_000,
        maxTokens: 128_000
      };
    },
    async listRemote() {
      return { models: [] };
    }
  };
}
