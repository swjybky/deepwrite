import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelUsageDashboard } from "@deepwrite/contracts";
import {
  DEEPWRITE_PUBLIC_DATA_API_CONFIGURED,
  deepWritePublicDataHeaders,
  deepWriteSoftwareTokenUsageUrl
} from "./deepwrite-public-data-config";
import { isRecord } from "@deepwrite/shared";
import { writeJsonAtomic } from "@deepwrite/shared/node";

export interface SoftwareTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

interface SoftwareTokenReport extends SoftwareTokenTotals {
  schemaVersion: 1;
  installationId: string;
  reportId: string;
  mode: "initial" | "increment";
}

interface PendingSoftwareTokenReport {
  report: SoftwareTokenReport;
  baselineAfterAck: SoftwareTokenTotals;
  dailyDate?: string;
}

interface SoftwareTokenReporterState {
  version: 1;
  installationId: string;
  acknowledgedTotals?: SoftwareTokenTotals;
  pending?: PendingSoftwareTokenReport;
  lastDailyReportDate?: string;
}

interface ModelUsageReader {
  flush(): Promise<void>;
  query(): Promise<ModelUsageDashboard>;
}

type ReporterFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface SoftwareTokenUsageReporterOptions {
  enabled?: boolean;
  fetcher?: ReporterFetcher;
  now?: () => number;
  createId?: () => string;
  reportUrl?: string;
  headers?: () => Headers;
  timeoutMs?: number;
}

const STATE_VERSION = 1;
const REPORT_TIMEOUT_MS = 3_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseTotals(value: unknown): SoftwareTokenTotals | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isTokenCount(value.inputTokens) ||
    !isTokenCount(value.outputTokens) ||
    !isTokenCount(value.cacheTokens)
  ) {
    return undefined;
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheTokens: value.cacheTokens
  };
}

function parseReport(value: unknown): SoftwareTokenReport | undefined {
  if (!isRecord(value)) return undefined;
  const totals = parseTotals(value);
  if (
    !totals ||
    value.schemaVersion !== 1 ||
    typeof value.installationId !== "string" ||
    !UUID_PATTERN.test(value.installationId) ||
    typeof value.reportId !== "string" ||
    !UUID_PATTERN.test(value.reportId) ||
    (value.mode !== "initial" && value.mode !== "increment")
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    installationId: value.installationId,
    reportId: value.reportId,
    mode: value.mode,
    ...totals
  };
}

function parseState(value: unknown): SoftwareTokenReporterState | undefined {
  if (
    !isRecord(value) ||
    value.version !== STATE_VERSION ||
    typeof value.installationId !== "string" ||
    !UUID_PATTERN.test(value.installationId)
  ) {
    return undefined;
  }
  const acknowledgedTotals =
    value.acknowledgedTotals === undefined
      ? undefined
      : parseTotals(value.acknowledgedTotals);
  if (value.acknowledgedTotals !== undefined && !acknowledgedTotals) {
    return undefined;
  }

  let pending: PendingSoftwareTokenReport | undefined;
  if (value.pending !== undefined) {
    if (!isRecord(value.pending)) return undefined;
    const report = parseReport(value.pending.report);
    const baselineAfterAck = parseTotals(value.pending.baselineAfterAck);
    const dailyDate = value.pending.dailyDate;
    if (
      !report ||
      !baselineAfterAck ||
      report.installationId !== value.installationId ||
      (dailyDate !== undefined && typeof dailyDate !== "string")
    ) {
      return undefined;
    }
    pending = {
      report,
      baselineAfterAck,
      ...(typeof dailyDate === "string" ? { dailyDate } : {})
    };
  }

  return {
    version: 1,
    installationId: value.installationId,
    ...(acknowledgedTotals ? { acknowledgedTotals } : {}),
    ...(pending ? { pending } : {}),
    ...(typeof value.lastDailyReportDate === "string"
      ? { lastDailyReportDate: value.lastDailyReportDate }
      : {})
  };
}

function totalsFromDashboard(
  dashboard: ModelUsageDashboard
): SoftwareTokenTotals {
  return {
    inputTokens: dashboard.totals.inputTokens,
    outputTokens: dashboard.totals.outputTokens,
    cacheTokens:
      dashboard.totals.cacheReadTokens + dashboard.totals.cacheWriteTokens
  };
}

function addHasPositiveValue(totals: SoftwareTokenTotals): boolean {
  return (
    totals.inputTokens > 0 || totals.outputTokens > 0 || totals.cacheTokens > 0
  );
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export class SoftwareTokenUsageReporter {
  readonly statePath: string;

  private readonly enabled: boolean;
  private readonly fetcher: ReporterFetcher;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly reportUrl: string;
  private readonly headers: () => Headers;
  private readonly timeoutMs: number;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly usageReader: ModelUsageReader,
    options: SoftwareTokenUsageReporterOptions = {}
  ) {
    this.statePath = join(
      userDataPath,
      "usage",
      "software-token-report-v1.json"
    );
    this.enabled = options.enabled ?? DEEPWRITE_PUBLIC_DATA_API_CONFIGURED;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.reportUrl = options.reportUrl ?? deepWriteSoftwareTokenUsageUrl();
    this.headers = options.headers ?? (() => deepWritePublicDataHeaders());
    this.timeoutMs = options.timeoutMs ?? REPORT_TIMEOUT_MS;
  }

  reportAtStartup(): Promise<void> {
    return this.enqueue(() => this.report("startup"));
  }

  reportBeforeShutdown(): Promise<void> {
    return this.enqueue(() => this.report("shutdown"));
  }

  private async report(reason: "startup" | "shutdown"): Promise<void> {
    if (!this.enabled) return;
    let state = await this.loadState();
    if (state.pending) {
      const sent = await this.sendPending(state);
      if (!sent) return;
      state = await this.loadState();
    }

    await this.usageReader.flush();
    const current = totalsFromDashboard(await this.usageReader.query());
    const today = localDate(this.now());
    let baseline = state.acknowledgedTotals;
    let rebased = false;
    if (baseline) {
      const nextBaseline = {
        inputTokens: Math.min(baseline.inputTokens, current.inputTokens),
        outputTokens: Math.min(baseline.outputTokens, current.outputTokens),
        cacheTokens: Math.min(baseline.cacheTokens, current.cacheTokens)
      };
      rebased =
        nextBaseline.inputTokens !== baseline.inputTokens ||
        nextBaseline.outputTokens !== baseline.outputTokens ||
        nextBaseline.cacheTokens !== baseline.cacheTokens;
      baseline = nextBaseline;
      if (rebased) {
        state.acknowledgedTotals = nextBaseline;
      }
    }

    const mode = baseline ? ("increment" as const) : ("initial" as const);
    const delta = baseline
      ? {
          inputTokens: current.inputTokens - baseline.inputTokens,
          outputTokens: current.outputTokens - baseline.outputTokens,
          cacheTokens: current.cacheTokens - baseline.cacheTokens
        }
      : { ...current };
    const dailyDue =
      reason === "startup" && state.lastDailyReportDate !== today;
    if (mode === "increment" && !addHasPositiveValue(delta) && !dailyDue) {
      if (rebased)
        await writeJsonAtomic(this.statePath, state, { directoryMode: 0o700 });
      return;
    }

    state.pending = {
      report: {
        schemaVersion: 1,
        installationId: state.installationId,
        reportId: this.createId(),
        mode,
        ...delta
      },
      baselineAfterAck: current,
      ...(dailyDue ? { dailyDate: today } : {})
    };
    await writeJsonAtomic(this.statePath, state, { directoryMode: 0o700 });
    await this.sendPending(state);
  }

  private async sendPending(
    state: SoftwareTokenReporterState
  ): Promise<boolean> {
    const pending = state.pending;
    if (!pending) return true;
    try {
      const headers = this.headers();
      headers.set("Accept", "application/json");
      headers.set("Content-Type", "application/json");
      const response = await this.fetcher(this.reportUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(pending.report),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) return false;
    } catch {
      return false;
    }

    state.acknowledgedTotals = pending.baselineAfterAck;
    if (pending.dailyDate) state.lastDailyReportDate = pending.dailyDate;
    delete state.pending;
    await writeJsonAtomic(this.statePath, state, { directoryMode: 0o700 });
    return true;
  }

  private async loadState(): Promise<SoftwareTokenReporterState> {
    try {
      const parsed = parseState(
        JSON.parse(await readFile(this.statePath, "utf8")) as unknown
      );
      if (parsed) return parsed;
    } catch (error: unknown) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) {
        // Invalid state is replaced below without exposing its content.
      }
    }
    const state: SoftwareTokenReporterState = {
      version: 1,
      installationId: this.createId()
    };
    await writeJsonAtomic(this.statePath, state, { directoryMode: 0o700 });
    return state;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.operationChain.then(operation);
    this.operationChain = queued.catch(() => undefined);
    return queued;
  }
}
