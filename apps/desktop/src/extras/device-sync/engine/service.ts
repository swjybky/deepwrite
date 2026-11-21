import {
  syncProgressTitle,
  syncDisplayText
} from "../../../localization/sync-display-text";
import {
  applySyncInitialization,
  prepareSyncInitialization,
  type PreparedSyncInitialization
} from "./initialization";
import {
  type SyncAdoption,
  type SyncApi,
  type SyncConfig,
  type SyncDirection,
  type SyncMetadata,
  type SyncProgress,
  type SyncResolution,
  type SyncServiceOptions,
  type SyncStatus,
  syncKey
} from "@deepwrite/contracts";
import {
  connectSync,
  configureSync,
  connectedSyncRemote,
  loadSyncMetadata,
  syncJoinCode
} from "./connection";
import { readSyncStatus, withSyncScope } from "./status";
import { preserveSync } from "./persistence";
import { runSync, type SyncRunState } from "./run";

const IDLE: SyncProgress = { phase: "idle", completed: 0, total: 0, title: "" };

export class DeviceSyncService implements SyncApi {
  private running = false;
  private prepared: PreparedSyncInitialization | null = null;
  private controller: AbortController | null = null;
  private state: SyncRunState = { progress: IDLE, issues: [] };
  private initialization: Promise<void> | null = null;
  private lastStatus: SyncStatus | null = null;
  private statusRead: Promise<SyncStatus> | null = null;
  private statusGeneration = 0;
  constructor(private readonly options: SyncServiceOptions) {}
  private async metadata(): Promise<SyncMetadata> {
    await this.options.workspace.recover();
    this.initialization ??= loadSyncMetadata(this.options)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    await this.initialization;
    return loadSyncMetadata(this.options);
  }

  /**
   * Reading the status scans every work, so polls never repeat it: while an operation holds the lock they get
   * the last status with live progress (the operation refreshes it when done), and concurrent reads share one.
   */
  async status(): Promise<SyncStatus> {
    if (this.running && this.lastStatus)
      return { ...this.lastStatus, progress: this.state.progress };
    this.statusRead ??= this.freshStatus().finally(() => {
      this.statusRead = null;
    });
    return this.statusRead;
  }
  private async freshStatus(): Promise<SyncStatus> {
    const generation = ++this.statusGeneration;
    const metadata = await this.metadata();
    const status = await readSyncStatus(
      this.options,
      metadata,
      this.state.progress
    );
    // A read that started before a later one finished must not replace it.
    if (generation === this.statusGeneration) this.lastStatus = status;
    return status;
  }
  async check(): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const metadata = await this.metadata();
      if (!metadata.config?.spaceId) return this.freshStatus();
      this.controller = new AbortController();
      this.state.progress = {
        ...IDLE,
        phase: "checking",
        ...syncProgressTitle("checkingUpdates")
      };
      try {
        const remote = await connectedSyncRemote(
          this.options,
          metadata.config,
          this.controller.signal
        );
        const devices = await remote.devices(
          metadata.config.spaceId,
          metadata.devices
        );
        if (this.controller.signal.aborted) throw new Error("同步已取消。");
        await this.options.metadata.write({
          ...metadata,
          devices,
          lastCheckedAt: this.options.runtime.now()
        });
        this.state.progress = {
          ...IDLE,
          ...syncProgressTitle("checkedUpdates")
        };
      } catch (error) {
        this.state.progress = {
          ...IDLE,
          phase: this.controller.signal.aborted ? "cancelled" : "failed",
          ...syncProgressTitle("checkIncomplete")
        };
        if (!this.controller.signal.aborted) throw error;
      } finally {
        this.controller = null;
      }
      return this.freshStatus();
    });
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error("同步正在进行，请稍候。");
    this.running = true;
    try {
      return await work();
    } finally {
      this.running = false;
    }
  }
  async connect(config: SyncConfig, password: string) {
    return this.exclusive(async () => {
      await this.metadata();
      return connectSync(this.options, config, password);
    });
  }
  async join(
    spaceId: string | null,
    name = "我的写作空间"
  ): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const metadata = await this.metadata();
      if (!metadata.config) throw new Error("请先连接网盘。");
      const remote = await connectedSyncRemote(this.options, metadata.config);
      const spaces = await remote.spaces();
      const space = spaceId
        ? spaces.find((entry) => entry.id === spaceId)
        : await remote.createSpace(name);
      if (!space) throw new Error("同步空间不存在，请重新选择。");
      const changed = metadata.config.spaceId !== space.id;
      await this.options.metadata.write({
        ...metadata,
        config: { ...metadata.config, spaceId: space.id },
        ...(changed
          ? {
              baselines: {},
              ancestors: {},
              published: null,
              firstSyncConfirmed: false,
              lastSuccessAt: null,
              pendingIssues: [],
              devices: [],
              lastCheckedAt: null
            }
          : {})
      });
      this.state.issues = [];
      return this.freshStatus();
    });
  }
  async configure(config: SyncConfig): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const next = await configureSync(
        this.options,
        await this.metadata(),
        config
      );
      if (!this.lastStatus) return this.freshStatus();
      this.statusGeneration++;
      this.lastStatus = withSyncScope(this.lastStatus, next);
      return { ...this.lastStatus, progress: this.state.progress };
    });
  }
  async joinCode(): Promise<string> {
    const metadata = await this.metadata();
    if (!metadata.config) throw new Error("请先连接网盘。");
    return syncJoinCode(metadata.config);
  }
  cancel(): void {
    this.controller?.abort();
  }

  async previewInitialization(deviceId: string) {
    return this.exclusive(async () => {
      this.prepared = null;
      this.controller = new AbortController();
      try {
        await this.metadata();
        this.prepared = await prepareSyncInitialization(
          this.options,
          this.state,
          deviceId,
          this.controller.signal
        );
        return this.prepared.preview;
      } catch (error) {
        this.state.progress = {
          ...IDLE,
          phase: this.controller.signal.aborted ? "cancelled" : "failed",
          ...syncProgressTitle("previewIncomplete")
        };
        throw error;
      } finally {
        this.controller = null;
      }
    });
  }
  async initializeFromRemote(token: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      this.controller = new AbortController();
      try {
        await applySyncInitialization(
          this.options,
          this.state,
          this.prepared,
          token,
          this.controller.signal
        );
      } catch (error) {
        this.state.progress = {
          ...IDLE,
          phase: this.controller.signal.aborted ? "cancelled" : "failed",
          ...syncProgressTitle("initializationFailed")
        };
        throw error;
      } finally {
        this.controller = null;
        this.prepared = null;
      }
      return this.freshStatus();
    });
  }

  async sync(
    resolutions: SyncResolution[] = [],
    confirmFirst = false,
    direction: SyncDirection = "both",
    adoption?: SyncAdoption
  ): Promise<SyncStatus> {
    return this.exclusive(async () => {
      this.controller = new AbortController();
      this.state.issues = [];
      try {
        await this.metadata();
        await runSync(
          this.options,
          this.state,
          resolutions,
          confirmFirst,
          direction,
          this.controller.signal,
          adoption
        );
      } catch (error) {
        this.state.progress = {
          ...this.state.progress,
          phase: this.controller.signal.aborted ? "cancelled" : "failed",
          ...syncProgressTitle(
            this.controller.signal.aborted ? "cancelled" : "syncFailed"
          )
        };
        if (!this.controller.signal.aborted) throw error;
      } finally {
        this.controller = null;
        const metadata = await this.metadata();
        await this.options.metadata.write({
          ...metadata,
          pendingIssues: this.state.issues
        });
      }
      return this.freshStatus();
    });
  }
  async restore(historyId: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const metadata = await this.metadata();
      const entry = metadata.history.find((value) => value.id === historyId);
      if (!entry?.item) throw new Error("该记录没有可恢复的作品内容。");
      const local = await this.options.workspace.list();
      const current =
        local.items.find((item) => syncKey(item) === entry.key) ?? null;
      await this.options.workspace.validate(entry.item);
      await preserveSync(
        this.options,
        metadata,
        entry.key,
        current,
        entry.title,
        syncDisplayText("beforeRestore").text
      );
      await this.options.workspace.apply(entry.key, current, entry.item);
      this.state.progress = {
        ...IDLE,
        ...syncProgressTitle("restored")
      };
      return this.freshStatus();
    });
  }
}
