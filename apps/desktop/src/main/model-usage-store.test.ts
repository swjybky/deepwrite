import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentUsage,
  ModelConfig,
  ModelUsageRecord
} from "@deepwrite/contracts";
import { ModelUsageStore, createModelUsageSnapshot } from "./model-usage-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-model-usage-store-"));
  temporaryRoots.add(root);
  return root;
}

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model-config-1",
    label: "测试模型",
    provider: "OpenAI",
    modelId: "gpt-test",
    api: "openai-completions",
    baseUrl: "https://api.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: true,
    ...overrides
  };
}

const DEFAULT_USAGE: AgentUsage = {
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  totalTokens: 37
};

function record(
  id: string,
  occurredAt: string,
  configuredModel: ModelConfig,
  overrides: Partial<ModelUsageRecord> = {}
): ModelUsageRecord {
  return {
    id,
    occurredAt,
    model: createModelUsageSnapshot(configuredModel),
    module: "short-writing",
    actor: "main-agent",
    status: "completed",
    usage: DEFAULT_USAGE,
    ...overrides
  };
}

function localDate(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0
): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
  temporaryRoots.clear();
});

describe("ModelUsageStore", () => {
  it("uses private v2 files, removes v1 data, and deduplicates after restart", async () => {
    const root = await makeTemporaryRoot();
    const legacyDirectory = join(root, "usage", "model-usage-v1");
    const legacyRegistry = join(root, "usage", "model-registry-v1.json");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, "2026-07.jsonl"), "{}\n", "utf8");
    await writeFile(legacyRegistry, "{}\n", "utf8");

    const configuredModel = model();
    const usageRecord = record(
      "event-1",
      "2026-07-02T12:00:00.000Z",
      configuredModel
    );
    const store = new ModelUsageStore(root);

    await store.syncConfiguredModels([configuredModel]);
    await store.record(usageRecord);
    await new ModelUsageStore(root).record(usageRecord);

    const ledger = JSON.parse(await readFile(store.ledgerPath, "utf8")) as {
      recentRecords: ModelUsageRecord[];
      rollups: unknown[];
    };
    const registry = await readFile(store.registryPath, "utf8");

    expect(ledger.recentRecords).toEqual([usageRecord]);
    expect(ledger.rollups).toEqual([]);
    expect(registry).not.toContain("apiKey");
    // Windows modes do not represent POSIX owner/group access bits.
    if (process.platform !== "win32") {
      expect((await stat(store.ledgerPath)).mode & 0o777).toBe(0o600);
      expect((await stat(store.registryPath)).mode & 0o777).toBe(0o600);
    }
    await expect(access(legacyDirectory)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(access(legacyRegistry)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("lists a current configuration before it has any usage", async () => {
    const root = await makeTemporaryRoot();
    const configuredModel = model({
      id: "unused-model-config",
      label: "尚未使用模型",
      modelId: "gpt-unused"
    });
    const store = new ModelUsageStore(root);

    await store.syncConfiguredModels([configuredModel]);
    const dashboard = await store.query();

    expect(dashboard.totals.requestCount).toBe(0);
    expect(dashboard.recentCalls).toEqual([]);
    expect(dashboard.models).toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ configId: "unused-model-config" }),
        status: "current",
        totals: expect.objectContaining({ requestCount: 0, totalTokens: 0 })
      })
    ]);
    expect(dashboard.models[0]?.lastUsedAt).toBeUndefined();
  });

  it("filters totals and fills local calendar trend buckets with zero days", async () => {
    const root = await makeTemporaryRoot();
    const firstModel = model();
    const changedModel = model({ modelId: "gpt-test-next" });
    const store = new ModelUsageStore(root);
    const firstDay = localDate(2026, 6, 1, 1);
    const thirdDay = localDate(2026, 6, 3, 1);

    await store.syncConfiguredModels([firstModel]);
    await store.record(record("event-1", firstDay, firstModel));
    await store.record(
      record("event-2", thirdDay, firstModel, {
        module: "learning-imitation",
        usage: {
          inputTokens: 5,
          outputTokens: 6,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 11
        }
      })
    );
    await store.syncConfiguredModels([changedModel]);

    const range = await store.query({
      startAt: localDate(2026, 6, 1),
      endAt: localDate(2026, 6, 3, 23, 59)
    });
    const imitationOnly = await store.query({
      modules: ["learning-imitation"]
    });

    expect(range.totals.requestCount).toBe(2);
    expect(range.totals.totalTokens).toBe(48);
    expect(range.trendGranularity).toBe("day");
    expect(range.trend).toHaveLength(3);
    expect(range.trend.map((point) => point.totals.requestCount)).toEqual([
      1, 0, 1
    ]);
    expect(new Date(range.trend[0]!.bucketStart).getHours()).toBe(0);
    expect(imitationOnly.totals).toEqual({
      inputTokens: 5,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 11,
      requestCount: 1
    });
    expect(imitationOnly.modules).toEqual([
      {
        module: "learning-imitation",
        totals: imitationOnly.totals
      }
    ]);
  });

  it("retains retired official-site usage as historical after restart", async () => {
    const root = await makeTemporaryRoot();
    const officialModel = model({
      id: "deepwrite-official-test",
      provider: "deepseek-official",
      modelId: "deepseek-official-test"
    });
    const customModel = model({ id: "custom-test", modelId: "custom-test" });
    const store = new ModelUsageStore(root);

    await store.syncConfiguredModels([customModel]);
    await store.record(
      record("official-event", localDate(2026, 6, 1), officialModel, {
        model: {
          ...createModelUsageSnapshot(officialModel),
          managedBy: "deepwrite-official"
        }
      })
    );
    await store.record(
      record("custom-event", localDate(2026, 6, 2), customModel, {
        usage: {
          inputTokens: 100,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 200
        }
      })
    );

    const dashboard = await new ModelUsageStore(root).query({
      managedBy: "deepwrite-official"
    });
    expect(dashboard.totals.totalTokens).toBe(DEFAULT_USAGE.totalTokens);
    expect(dashboard.models).toHaveLength(1);
    expect(dashboard.models[0]?.status).toBe("historical");
    expect(dashboard.models[0]?.model).toMatchObject({
      configId: "deepwrite-official-test",
      managedBy: "deepwrite-official"
    });
    expect(dashboard.recentCalls).toHaveLength(1);
    expect(dashboard.recentCalls[0]?.model.configId).toBe(
      "deepwrite-official-test"
    );
  });

  it("retains 100 details, exposes 50 calls, and preserves older aggregate totals", async () => {
    const root = await makeTemporaryRoot();
    const configuredModel = model();
    const store = new ModelUsageStore(root);
    const start = Date.now() - 4 * 60 * 60 * 1_000;

    await store.syncConfiguredModels([configuredModel]);
    for (let index = 0; index < 155; index += 1) {
      await store.record(
        record(
          `event-${index.toString().padStart(3, "0")}`,
          new Date(start + index * 60_000).toISOString(),
          configuredModel
        )
      );
    }

    const ledger = JSON.parse(await readFile(store.ledgerPath, "utf8")) as {
      recentRecords: ModelUsageRecord[];
      rollups: Array<{ totals: { requestCount: number } }>;
    };
    const dashboard = await store.query();

    expect(ledger.recentRecords).toHaveLength(100);
    expect(
      ledger.rollups.reduce((total, row) => total + row.totals.requestCount, 0)
    ).toBe(55);
    expect(dashboard.totals.requestCount).toBe(155);
    expect(dashboard.totals.totalTokens).toBe(155 * DEFAULT_USAGE.totalTokens);
    expect(dashboard.recentCalls).toHaveLength(50);
    expect(dashboard.recentCalls[0]?.occurredAt).toBe(
      new Date(start + 154 * 60_000).toISOString()
    );
  });

  it("keeps hourly buckets for a rolling 24-hour query", async () => {
    const root = await makeTemporaryRoot();
    const configuredModel = model();
    const store = new ModelUsageStore(root);
    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - 24 * 60 * 60 * 1_000);

    await store.record(
      record(
        "event-hourly",
        new Date(endAt.getTime() - 30 * 60_000).toISOString(),
        configuredModel
      )
    );
    const dashboard = await store.query({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString()
    });

    expect(dashboard.trendGranularity).toBe("hour");
    expect(dashboard.trend.length).toBeGreaterThanOrEqual(24);
    expect(
      dashboard.trend.reduce(
        (count, point) => count + point.totals.requestCount,
        0
      )
    ).toBe(1);
  });
});
