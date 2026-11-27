import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  MODEL_USAGE_MODULES,
  ModelConfigSchema,
  ModelUsageDashboardSchema,
  ModelUsageModelSnapshotSchema,
  ModelUsageModuleSchema,
  ModelUsageQueryInputSchema,
  ModelUsageRecordSchema,
  ModelUsageTotalsSchema,
  ModelUsageTrendGranularitySchema,
  type AgentUsage,
  type ModelConfig,
  type ModelUsageDashboard,
  type ModelUsageModelSnapshot,
  type ModelUsageModule,
  type ModelUsageQueryInput,
  type ModelUsageRecord,
  type ModelUsageTotals,
  type ModelUsageTrendGranularity
} from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";
import { writeJsonAtomic, isNodeError } from "@deepwrite/shared/node";

interface DiskModelUsageRegistry {
  version: 2;
  models: Record<string, ModelUsageModelSnapshot>;
  activeConfigRevisions: Record<string, string>;
}

interface DiskModelUsageRollup {
  bucketStart: string;
  granularity: ModelUsageTrendGranularity;
  model: ModelUsageModelSnapshot;
  module: ModelUsageModule;
  totals: ModelUsageTotals;
  firstUsedAt: string;
  lastUsedAt: string;
}

interface DiskModelUsageLedger {
  version: 2;
  recentRecords: ModelUsageRecord[];
  rollups: DiskModelUsageRollup[];
}

interface MutableModelSummary {
  model: ModelUsageModelSnapshot;
  totals: ModelUsageTotals;
  firstUsedAt?: string;
  lastUsedAt?: string;
}

interface UsageContribution {
  bucketStart: string;
  bucketGranularity: ModelUsageTrendGranularity;
  model: ModelUsageModelSnapshot;
  module: ModelUsageModule;
  totals: ModelUsageTotals;
  firstUsedAt: string;
  lastUsedAt: string;
}

const RECENT_RECORD_LIMIT = 100;
const RECENT_CALL_DISPLAY_LIMIT = 50;
const HOURLY_ROLLUP_RETENTION_MS = 35 * 24 * 60 * 60 * 1_000;
const DAILY_ROLLUP_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;
const FAUX_CONFIG_ID_PREFIX = "runtime:";

const EMPTY_REGISTRY: DiskModelUsageRegistry = {
  version: 2,
  models: {},
  activeConfigRevisions: {}
};

const EMPTY_LEDGER: DiskModelUsageLedger = {
  version: 2,
  recentRecords: [],
  rollups: []
};

function toTimestamp(value: string): number {
  return Date.parse(value);
}

function normalizeEndpointIdentity(baseUrl: string): string {
  if (!baseUrl.trim()) return "";
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return `${url.origin.toLowerCase()}${pathname}`;
  } catch {
    return "";
  }
}

function registryKey(
  model: Pick<ModelUsageModelSnapshot, "configId" | "revisionId">
): string {
  return createHash("sha256")
    .update(`${model.configId}\u0000${model.revisionId}`, "utf8")
    .digest("hex");
}

function sameSnapshot(
  left: ModelUsageModelSnapshot | undefined,
  right: ModelUsageModelSnapshot
): boolean {
  if (!left) return false;
  return (
    left.configId === right.configId &&
    left.revisionId === right.revisionId &&
    left.label === right.label &&
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.api === right.api &&
    left.managedBy === right.managedBy
  );
}

function sameActiveMap(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(
    ([configId, revisionId]) => right[configId] === revisionId
  );
}

function emptyTotals(): ModelUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    requestCount: 0
  };
}

function totalsFromUsage(usage: AgentUsage): ModelUsageTotals {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    requestCount: 1
  };
}

function addTotals(target: ModelUsageTotals, source: ModelUsageTotals): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.totalTokens += source.totalTokens;
  target.requestCount += source.requestCount;
}

function isFauxModel(model: ModelUsageModelSnapshot): boolean {
  return model.configId.startsWith(FAUX_CONFIG_ID_PREFIX);
}

function localBucketStart(
  value: string | number | Date,
  granularity: ModelUsageTrendGranularity
): string {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (granularity === "hour") {
    date.setMinutes(0, 0, 0);
  } else if (granularity === "day") {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

function nextLocalBucket(
  bucketStart: string,
  granularity: ModelUsageTrendGranularity
): string {
  const date = new Date(bucketStart);
  if (granularity === "hour") {
    date.setHours(date.getHours() + 1);
  } else if (granularity === "day") {
    date.setDate(date.getDate() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString();
}

function resolveTrendGranularity(
  startAt: string,
  endAt: string
): ModelUsageTrendGranularity {
  const durationMs = Math.max(0, toTimestamp(endAt) - toTimestamp(startAt));
  if (durationMs <= 36 * 60 * 60 * 1_000) return "hour";
  if (durationMs <= 120 * 24 * 60 * 60 * 1_000) return "day";
  return "month";
}

function rollupKey(
  row: Pick<
    DiskModelUsageRollup,
    "bucketStart" | "granularity" | "model" | "module"
  >
): string {
  return [
    row.granularity,
    row.bucketStart,
    registryKey(row.model),
    row.module
  ].join("\u0000");
}

function mergeRollups(
  rows: readonly DiskModelUsageRollup[]
): DiskModelUsageRollup[] {
  const merged = new Map<string, DiskModelUsageRollup>();
  for (const row of rows) {
    const key = rollupKey(row);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...row,
        totals: { ...row.totals }
      });
      continue;
    }
    addTotals(existing.totals, row.totals);
    if (toTimestamp(row.firstUsedAt) < toTimestamp(existing.firstUsedAt)) {
      existing.firstUsedAt = row.firstUsedAt;
    }
    if (toTimestamp(row.lastUsedAt) > toTimestamp(existing.lastUsedAt)) {
      existing.lastUsedAt = row.lastUsedAt;
    }
  }
  return [...merged.values()].sort((left, right) => {
    const timeDifference = left.bucketStart.localeCompare(right.bucketStart);
    return timeDifference || rollupKey(left).localeCompare(rollupKey(right));
  });
}

function compactRollups(
  rows: readonly DiskModelUsageRollup[],
  now: number
): DiskModelUsageRollup[] {
  const hourlyCutoff = now - HOURLY_ROLLUP_RETENTION_MS;
  const dailyCutoff = now - DAILY_ROLLUP_RETENTION_MS;
  return mergeRollups(
    rows.map((row) => {
      const bucketTimestamp = toTimestamp(row.bucketStart);
      let granularity = row.granularity;
      if (granularity === "hour" && bucketTimestamp < hourlyCutoff) {
        granularity = "day";
      }
      if (granularity === "day" && bucketTimestamp < dailyCutoff) {
        granularity = "month";
      }
      if (granularity === row.granularity) return row;
      return {
        ...row,
        granularity,
        bucketStart: localBucketStart(row.bucketStart, granularity)
      };
    })
  );
}

function addRecordToRollups(
  rows: readonly DiskModelUsageRollup[],
  record: ModelUsageRecord,
  now: number
): DiskModelUsageRollup[] {
  return compactRollups(
    [
      ...rows,
      {
        bucketStart: localBucketStart(record.occurredAt, "hour"),
        granularity: "hour",
        model: record.model,
        module: record.module,
        totals: totalsFromUsage(record.usage),
        firstUsedAt: record.occurredAt,
        lastUsedAt: record.occurredAt
      }
    ],
    now
  );
}

function contributionOverlapsRange(
  contribution: UsageContribution,
  startAt: number | undefined,
  endAt: number | undefined
): boolean {
  const bucketStart = toTimestamp(contribution.bucketStart);
  const bucketEnd = toTimestamp(
    nextLocalBucket(contribution.bucketStart, contribution.bucketGranularity)
  );
  return !(
    (startAt !== undefined && bucketEnd <= startAt) ||
    (endAt !== undefined && bucketStart > endAt)
  );
}

function normalizeRegistry(raw: unknown): DiskModelUsageRegistry {
  if (!isRecord(raw) || raw.version !== 2) {
    return structuredClone(EMPTY_REGISTRY);
  }

  const models: Record<string, ModelUsageModelSnapshot> = {};
  if (isRecord(raw.models)) {
    for (const [key, value] of Object.entries(raw.models)) {
      const parsed = ModelUsageModelSnapshotSchema.safeParse(value);
      if (parsed.success) models[key] = parsed.data;
    }
  }

  const activeConfigRevisions: Record<string, string> = {};
  if (isRecord(raw.activeConfigRevisions)) {
    for (const [configId, revisionId] of Object.entries(
      raw.activeConfigRevisions
    )) {
      if (
        configId.trim().length > 0 &&
        configId.length <= 120 &&
        typeof revisionId === "string" &&
        revisionId.trim().length > 0 &&
        revisionId.length <= 128
      ) {
        activeConfigRevisions[configId] = revisionId;
      }
    }
  }

  return { version: 2, models, activeConfigRevisions };
}

function parseRollup(raw: unknown): DiskModelUsageRollup | undefined {
  if (!isRecord(raw)) return undefined;
  const granularity = ModelUsageTrendGranularitySchema.safeParse(
    raw.granularity
  );
  const model = ModelUsageModelSnapshotSchema.safeParse(raw.model);
  const module = ModelUsageModuleSchema.safeParse(raw.module);
  const totals = ModelUsageTotalsSchema.safeParse(raw.totals);
  if (
    typeof raw.bucketStart !== "string" ||
    !Number.isFinite(Date.parse(raw.bucketStart)) ||
    typeof raw.firstUsedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.firstUsedAt)) ||
    typeof raw.lastUsedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.lastUsedAt)) ||
    !granularity.success ||
    !model.success ||
    !module.success ||
    !totals.success
  ) {
    return undefined;
  }
  return {
    bucketStart: new Date(raw.bucketStart).toISOString(),
    granularity: granularity.data,
    model: model.data,
    module: module.data,
    totals: totals.data,
    firstUsedAt: new Date(raw.firstUsedAt).toISOString(),
    lastUsedAt: new Date(raw.lastUsedAt).toISOString()
  };
}

function normalizeLedger(raw: unknown): DiskModelUsageLedger {
  if (!isRecord(raw) || raw.version !== 2) {
    return structuredClone(EMPTY_LEDGER);
  }

  const recentRecords = Array.isArray(raw.recentRecords)
    ? raw.recentRecords
        .map((value) => ModelUsageRecordSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data)
        .sort(compareRecords)
        .slice(-RECENT_RECORD_LIMIT)
    : [];
  const rollups = Array.isArray(raw.rollups)
    ? raw.rollups
        .map(parseRollup)
        .filter((row): row is DiskModelUsageRollup => row !== undefined)
    : [];

  return {
    version: 2,
    recentRecords,
    rollups: compactRollups(rollups, Date.now())
  };
}

function compareRecords(
  left: ModelUsageRecord,
  right: ModelUsageRecord
): number {
  const timeDifference =
    toTimestamp(left.occurredAt) - toTimestamp(right.occurredAt);
  return timeDifference || left.id.localeCompare(right.id);
}

export function createModelUsageRevisionId(
  model: Pick<
    ModelConfig,
    "provider" | "modelId" | "requestModelId" | "api" | "baseUrl"
  >
): string {
  const source = [
    "deepwrite-model-usage-revision-v2",
    model.provider.trim().toLowerCase(),
    model.modelId.trim(),
    model.requestModelId?.trim() ?? "",
    model.api.trim(),
    normalizeEndpointIdentity(model.baseUrl)
  ].join("\u0000");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function createModelUsageSnapshot(
  model: ModelConfig
): ModelUsageModelSnapshot {
  const parsed = ModelConfigSchema.parse(model);
  return ModelUsageModelSnapshotSchema.parse({
    configId: parsed.id,
    revisionId: createModelUsageRevisionId(parsed),
    label: parsed.label,
    provider: parsed.provider,
    modelId: parsed.modelId,
    api: parsed.api,
    ...(parsed.managedBy ? { managedBy: parsed.managedBy } : {})
  });
}

export class ModelUsageStore {
  readonly usageDirectory: string;
  readonly ledgerPath: string;
  readonly registryPath: string;

  private readonly legacyRecordsDirectory: string;
  private readonly legacyRegistryPath: string;
  private operationChain: Promise<void> = Promise.resolve();
  private storageInitialized = false;

  constructor(userDataPath: string) {
    this.usageDirectory = join(userDataPath, "usage");
    this.ledgerPath = join(this.usageDirectory, "model-usage-ledger-v2.json");
    this.registryPath = join(this.usageDirectory, "model-registry-v2.json");
    this.legacyRecordsDirectory = join(this.usageDirectory, "model-usage-v1");
    this.legacyRegistryPath = join(
      this.usageDirectory,
      "model-registry-v1.json"
    );
  }

  async flush(): Promise<void> {
    await this.operationChain;
  }

  async record(rawRecord: ModelUsageRecord): Promise<void> {
    const record = ModelUsageRecordSchema.parse(rawRecord);
    await this.enqueue(async () => {
      await this.ensureStorageInitialized();
      const [registry, ledger] = await Promise.all([
        this.readRegistry(),
        this.readLedger()
      ]);
      if (ledger.recentRecords.some((candidate) => candidate.id === record.id))
        return;

      const key = registryKey(record.model);
      if (!sameSnapshot(registry.models[key], record.model)) {
        registry.models[key] = record.model;
        await this.writeRegistry(registry);
      }

      const recentRecords = [...ledger.recentRecords, record].sort(
        compareRecords
      );
      let rollups = ledger.rollups;
      while (recentRecords.length > RECENT_RECORD_LIMIT) {
        const pruned = recentRecords.shift();
        if (pruned) rollups = addRecordToRollups(rollups, pruned, Date.now());
      }
      await this.writeLedger({ version: 2, recentRecords, rollups });
    });
  }

  async syncConfiguredModels(rawModels: readonly ModelConfig[]): Promise<void> {
    const models = rawModels.map((model) => ModelConfigSchema.parse(model));
    await this.enqueue(async () => {
      await this.ensureStorageInitialized();
      const registry = await this.readRegistry();
      const activeConfigRevisions: Record<string, string> = {};
      let changed = false;

      for (const model of models) {
        const snapshot = createModelUsageSnapshot(model);
        activeConfigRevisions[snapshot.configId] = snapshot.revisionId;
        const key = registryKey(snapshot);
        if (!sameSnapshot(registry.models[key], snapshot)) {
          registry.models[key] = snapshot;
          changed = true;
        }
      }

      if (
        !sameActiveMap(registry.activeConfigRevisions, activeConfigRevisions)
      ) {
        registry.activeConfigRevisions = activeConfigRevisions;
        changed = true;
      }
      if (changed) await this.writeRegistry(registry);
    });
  }

  async query(
    rawInput: ModelUsageQueryInput = {}
  ): Promise<ModelUsageDashboard> {
    const input = ModelUsageQueryInputSchema.parse(rawInput);
    return this.enqueue(async () => {
      await this.ensureStorageInitialized();
      const [registry, ledger] = await Promise.all([
        this.readRegistry(),
        this.readLedger()
      ]);
      const modelConfigIds = input.modelConfigIds
        ? new Set(input.modelConfigIds)
        : undefined;
      const managedBy = input.managedBy;
      const modules = input.modules ? new Set(input.modules) : undefined;
      const startAt = input.startAt ? toTimestamp(input.startAt) : undefined;
      const endAt = input.endAt ? toTimestamp(input.endAt) : undefined;
      const generatedAt = new Date().toISOString();

      const contributions: UsageContribution[] = [];
      for (const row of ledger.rollups) {
        const contribution: UsageContribution = {
          bucketStart: row.bucketStart,
          bucketGranularity: row.granularity,
          model: row.model,
          module: row.module,
          totals: row.totals,
          firstUsedAt: row.firstUsedAt,
          lastUsedAt: row.lastUsedAt
        };
        if (
          (modelConfigIds && !modelConfigIds.has(row.model.configId)) ||
          (managedBy && row.model.managedBy !== managedBy) ||
          (modules && !modules.has(row.module)) ||
          !contributionOverlapsRange(contribution, startAt, endAt)
        ) {
          continue;
        }
        contributions.push(contribution);
      }

      for (const record of ledger.recentRecords) {
        const occurredAt = toTimestamp(record.occurredAt);
        if (
          (startAt !== undefined && occurredAt < startAt) ||
          (endAt !== undefined && occurredAt > endAt) ||
          (modelConfigIds && !modelConfigIds.has(record.model.configId)) ||
          (managedBy && record.model.managedBy !== managedBy) ||
          (modules && !modules.has(record.module))
        ) {
          continue;
        }
        contributions.push({
          bucketStart: localBucketStart(record.occurredAt, "hour"),
          bucketGranularity: "hour",
          model: record.model,
          module: record.module,
          totals: totalsFromUsage(record.usage),
          firstUsedAt: record.occurredAt,
          lastUsedAt: record.occurredAt
        });
      }

      const totals = emptyTotals();
      const modelSummaries = new Map<string, MutableModelSummary>();
      const moduleSummaries = new Map<ModelUsageModule, ModelUsageTotals>();
      for (const contribution of contributions) {
        addTotals(totals, contribution.totals);

        const modelKey = registryKey(contribution.model);
        const summary = modelSummaries.get(modelKey);
        if (!summary) {
          modelSummaries.set(modelKey, {
            model: registry.models[modelKey] ?? contribution.model,
            totals: { ...contribution.totals },
            firstUsedAt: contribution.firstUsedAt,
            lastUsedAt: contribution.lastUsedAt
          });
        } else {
          addTotals(summary.totals, contribution.totals);
          if (
            !summary.firstUsedAt ||
            toTimestamp(contribution.firstUsedAt) <
              toTimestamp(summary.firstUsedAt)
          ) {
            summary.firstUsedAt = contribution.firstUsedAt;
          }
          if (
            !summary.lastUsedAt ||
            toTimestamp(contribution.lastUsedAt) >
              toTimestamp(summary.lastUsedAt)
          ) {
            summary.lastUsedAt = contribution.lastUsedAt;
          }
        }

        const moduleTotals =
          moduleSummaries.get(contribution.module) ?? emptyTotals();
        addTotals(moduleTotals, contribution.totals);
        moduleSummaries.set(contribution.module, moduleTotals);
      }

      if (!modules) {
        for (const model of Object.values(registry.models)) {
          if (modelConfigIds && !modelConfigIds.has(model.configId)) continue;
          if (managedBy && model.managedBy !== managedBy) continue;
          const key = registryKey(model);
          if (!modelSummaries.has(key)) {
            modelSummaries.set(key, { model, totals: emptyTotals() });
          }
        }
      }

      const modelRows = [...modelSummaries.values()]
        .map((summary) => ({
          ...summary,
          status: isFauxModel(summary.model)
            ? ("faux" as const)
            : registry.activeConfigRevisions[summary.model.configId] ===
                summary.model.revisionId
              ? ("current" as const)
              : ("historical" as const)
        }))
        .sort((left, right) => {
          if (right.totals.totalTokens !== left.totals.totalTokens) {
            return right.totals.totalTokens - left.totals.totalTokens;
          }
          const statusRank = { current: 0, historical: 1, faux: 2 } as const;
          if (statusRank[left.status] !== statusRank[right.status]) {
            return statusRank[left.status] - statusRank[right.status];
          }
          return (
            (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") ||
            left.model.label.localeCompare(right.model.label)
          );
        });

      const earliest = contributions.reduce<string | undefined>(
        (value, contribution) =>
          !value || toTimestamp(contribution.firstUsedAt) < toTimestamp(value)
            ? contribution.firstUsedAt
            : value,
        undefined
      );
      const trendStart = input.startAt ?? earliest;
      const trendEnd = input.endAt ?? generatedAt;
      const trendGranularity = trendStart
        ? resolveTrendGranularity(trendStart, trendEnd)
        : "day";
      const trendTotals = new Map<string, ModelUsageTotals>();
      for (const contribution of contributions) {
        const bucketStart = localBucketStart(
          contribution.bucketStart,
          trendGranularity
        );
        const bucketTotals = trendTotals.get(bucketStart) ?? emptyTotals();
        addTotals(bucketTotals, contribution.totals);
        trendTotals.set(bucketStart, bucketTotals);
      }

      const trend: Array<{ bucketStart: string; totals: ModelUsageTotals }> =
        [];
      if (trendStart) {
        let cursor = localBucketStart(trendStart, trendGranularity);
        const finalBucket = localBucketStart(trendEnd, trendGranularity);
        while (toTimestamp(cursor) <= toTimestamp(finalBucket)) {
          trend.push({
            bucketStart: cursor,
            totals: trendTotals.get(cursor) ?? emptyTotals()
          });
          cursor = nextLocalBucket(cursor, trendGranularity);
        }
      }

      const recentCalls = ledger.recentRecords
        .slice()
        .filter((record) => {
          const occurredAt = toTimestamp(record.occurredAt);
          return !(
            (startAt !== undefined && occurredAt < startAt) ||
            (endAt !== undefined && occurredAt > endAt) ||
            (modelConfigIds && !modelConfigIds.has(record.model.configId)) ||
            (managedBy && record.model.managedBy !== managedBy) ||
            (modules && !modules.has(record.module))
          );
        })
        .sort((left, right) => compareRecords(right, left))
        .slice(0, RECENT_CALL_DISPLAY_LIMIT)
        .map(({ id: _id, ...call }) => call);

      return ModelUsageDashboardSchema.parse({
        generatedAt,
        totals,
        trendGranularity,
        trend,
        models: modelRows,
        modules: MODEL_USAGE_MODULES.filter((module) =>
          moduleSummaries.has(module)
        ).map((module) => ({ module, totals: moduleSummaries.get(module)! })),
        recentCalls
      });
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await rm(this.ledgerPath, { force: true });
      await rm(this.registryPath, { force: true });
      await rm(this.legacyRecordsDirectory, { recursive: true, force: true });
      await rm(this.legacyRegistryPath, { force: true });
      this.storageInitialized = true;
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.operationChain.then(operation);
    this.operationChain = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  private async ensureStorageInitialized(): Promise<void> {
    if (this.storageInitialized) return;
    await mkdir(this.usageDirectory, { recursive: true, mode: 0o700 });
    await rm(this.legacyRecordsDirectory, { recursive: true, force: true });
    await rm(this.legacyRegistryPath, { force: true });
    this.storageInitialized = true;
  }

  private async readRegistry(): Promise<DiskModelUsageRegistry> {
    try {
      return normalizeRegistry(
        JSON.parse(await readFile(this.registryPath, "utf8")) as unknown
      );
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return structuredClone(EMPTY_REGISTRY);
      }
      throw error;
    }
  }

  private async writeRegistry(registry: DiskModelUsageRegistry): Promise<void> {
    await writeJsonAtomic(this.registryPath, registry, {
      directoryMode: 0o700
    });
  }

  private async readLedger(): Promise<DiskModelUsageLedger> {
    try {
      return normalizeLedger(
        JSON.parse(await readFile(this.ledgerPath, "utf8")) as unknown
      );
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return structuredClone(EMPTY_LEDGER);
      }
      throw error;
    }
  }

  private async writeLedger(ledger: DiskModelUsageLedger): Promise<void> {
    await writeJsonAtomic(this.ledgerPath, ledger, { directoryMode: 0o700 });
  }
}
