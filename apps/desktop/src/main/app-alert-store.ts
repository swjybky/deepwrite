import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppAlertHistoryEntrySchema,
  AppAlertManifestSchema,
  type AppAlertHistoryEntry,
  AppAlertSnapshotSchema,
  type AppAlertManifest,
  type AppAlertSnapshot
} from "@deepwrite/contracts";
import {
  deepWritePublicDataHeaders,
  deepWritePublicDataUrl
} from "./deepwrite-public-data-config";
import { electronRemoteFetch } from "./electron-remote-fetch";
import { writeJsonAtomic } from "@deepwrite/shared/node";

export const APP_ALERT_CONFIG_URL = deepWritePublicDataUrl("ALERT.json");

const REMOTE_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REMOTE_CONFIG_BYTES = 64 * 1_024;

const FALLBACK_MANIFEST: AppAlertManifest = {
  desketop: [],
  model: []
};

interface AppAlertStateFile {
  version: 1;
  fetchedAt: string;
  manifest: AppAlertManifest;
  lastSeenDesktopRevision?: string;
  history?: AppAlertHistoryEntry[];
}

type RemoteConfigFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface AppAlertStoreOptions {
  fetcher?: RemoteConfigFetcher;
  configUrl?: string;
  now?: () => number;
}

function desktopRevision(messages: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

function parseStateFile(raw: unknown): AppAlertStateFile | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1 || typeof record.fetchedAt !== "string")
    return undefined;
  const manifest = AppAlertManifestSchema.safeParse(record.manifest);
  if (!manifest.success) return undefined;
  const lastSeenDesktopRevision =
    typeof record.lastSeenDesktopRevision === "string" &&
    /^[a-f0-9]{64}$/u.test(record.lastSeenDesktopRevision)
      ? record.lastSeenDesktopRevision
      : undefined;
  return {
    version: 1,
    fetchedAt: record.fetchedAt,
    manifest: manifest.data,
    history: Array.isArray(record.history)
      ? record.history.flatMap((entry) => {
          const parsed = AppAlertHistoryEntrySchema.safeParse(entry);
          return parsed.success &&
            parsed.data.revision === desktopRevision(parsed.data.messages)
            ? [parsed.data]
            : [];
        })
      : [],
    ...(lastSeenDesktopRevision ? { lastSeenDesktopRevision } : {})
  };
}

export class AppAlertStore {
  private readonly statePath: string;
  private readonly fetcher: RemoteConfigFetcher;
  private readonly configUrl: string;
  private readonly now: () => number;
  private readonly stateLoad: Promise<void>;
  private manifest: AppAlertManifest = structuredClone(FALLBACK_MANIFEST);
  private fetchedAt = "";
  private history: AppAlertHistoryEntry[] = [];
  private lastSeenDesktopRevision: string | undefined;
  private refreshPromise: Promise<void> | undefined;

  constructor(userDataPath: string, options: AppAlertStoreOptions = {}) {
    this.statePath = join(userDataPath, "config", "app-alert-state.json");
    this.fetcher = options.fetcher ?? electronRemoteFetch;
    this.configUrl = options.configUrl ?? APP_ALERT_CONFIG_URL;
    this.now = options.now ?? Date.now;
    this.stateLoad = this.loadState();
  }

  async getSnapshot(): Promise<AppAlertSnapshot> {
    await this.stateLoad;
    await this.refreshRemote();
    return this.snapshot();
  }

  async acknowledgeDesktop(revision: string): Promise<void> {
    await this.stateLoad;
    const currentRevision = desktopRevision(this.manifest.desketop);
    if (revision !== currentRevision) {
      throw new Error("启动提醒内容已经更新，请重新读取后再确认。");
    }
    this.lastSeenDesktopRevision = currentRevision;
    await this.persistState();
  }

  private snapshot(): AppAlertSnapshot {
    const revision = desktopRevision(this.manifest.desketop);
    return AppAlertSnapshotSchema.parse({
      desktopMessages: this.manifest.desketop,
      modelMessages: this.manifest.model,
      pcLatestVersion: this.manifest.pcLatestVersion,
      officialDocsUrl: this.manifest.officialDocsUrl,
      desktopRevision: revision,
      history: this.history,
      shouldShowDesktop:
        this.manifest.desketop.length > 0 &&
        this.lastSeenDesktopRevision !== revision
    });
  }

  private async refreshRemote(): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    const operation = this.fetchRemote();
    this.refreshPromise = operation;
    try {
      await operation;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async fetchRemote(): Promise<void> {
    try {
      const now = this.now();
      const requestUrl = new URL(this.configUrl);
      requestUrl.searchParams.set("deepwrite_cache_bust", String(now));
      const response = await this.fetcher(requestUrl.toString(), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
        headers: deepWritePublicDataHeaders({
          Accept: "application/json",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache"
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_CONFIG_BYTES) {
        throw new Error("提醒配置文件超过大小限制");
      }
      this.manifest = AppAlertManifestSchema.parse(JSON.parse(text) as unknown);
      this.fetchedAt = new Date(now).toISOString();
      this.archiveDesktop();
      await this.persistState();
    } catch {
      // Only show model announcements and documentation links from a successful fetch.
      this.manifest.model = [];
      delete this.manifest.officialDocsUrl;
    }
  }

  private async loadState(): Promise<void> {
    try {
      const parsed = parseStateFile(
        JSON.parse(await readFile(this.statePath, "utf8")) as unknown
      );
      if (!parsed) return;
      this.manifest = parsed.manifest;
      this.fetchedAt = parsed.fetchedAt;
      this.lastSeenDesktopRevision = parsed.lastSeenDesktopRevision;
      this.history = parsed.history ?? [];
      this.archiveDesktop();
    } catch {
      this.manifest = structuredClone(FALLBACK_MANIFEST);
    }
  }

  private archiveDesktop(): void {
    const messages = this.manifest.desketop;
    const revision = desktopRevision(messages);
    if (
      !messages.length ||
      this.history.some((entry) => entry.revision === revision)
    )
      return;
    this.history.unshift({
      revision,
      receivedAt: Number.isFinite(Date.parse(this.fetchedAt))
        ? new Date(this.fetchedAt).toISOString()
        : new Date(this.now()).toISOString(),
      messages: [...messages]
    });
  }

  private async persistState(): Promise<void> {
    await writeJsonAtomic(this.statePath, {
      version: 1,
      fetchedAt: this.fetchedAt || new Date(this.now()).toISOString(),
      manifest: this.manifest,
      history: this.history,
      ...(this.lastSeenDesktopRevision
        ? { lastSeenDesktopRevision: this.lastSeenDesktopRevision }
        : {})
    } satisfies AppAlertStateFile);
  }
}
