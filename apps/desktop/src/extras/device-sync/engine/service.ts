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
import { readSyncStatus } from "./status";
import { preserveSync } from "./persistence";
import { runSync, type SyncRunState } from "./run";

const IDLE: SyncProgress = { phase: "idle", completed: 0, total: 0, title: "" };

export class DeviceSyncService implements SyncApi {
  private running = false;
  private controller: AbortController | null = null;
  private state: SyncRunState = { progress: IDLE, issues: [] };
  private initialization: Promise<void> | null = null;
  constructor(private readonly options: SyncServiceOptions) {}
  private async metadata(): Promise<SyncMetadata> {
    this.initialization ??= loadSyncMetadata(this.options)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    await this.initialization;
    return loadSyncMetadata(this.options);
  }

  async status(): Promise<SyncStatus> {
    return readSyncStatus(
      this.options,
      await this.metadata(),
      this.state.progress
    );
  }
  async check(): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const metadata = await this.metadata();
      if (!metadata.config?.spaceId) return this.status();
      this.controller = new AbortController();
      this.state.progress = {
        ...IDLE,
        phase: "checking",
        title: "检查远端更新"
      };
      try {
        const remote = await connectedSyncRemote(
          this.options,
          metadata.config,
          this.controller.signal
        );
        const devices = await remote.devices(metadata.config.spaceId);
        if (this.controller.signal.aborted) throw new Error("同步已取消。");
        await this.options.metadata.write({
          ...metadata,
          devices,
          lastCheckedAt: this.options.runtime.now()
        });
        this.state.progress = {
          ...IDLE,
          title: "已检查远端更新，尚未上传或下载内容"
        };
      } catch (error) {
        this.state.progress = {
          ...IDLE,
          phase: this.controller.signal.aborted ? "cancelled" : "failed",
          title: "未完成远端检查，当前显示上次检查记录"
        };
        if (!this.controller.signal.aborted) throw error;
      } finally {
        this.controller = null;
      }
      return this.status();
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
      return this.status();
    });
  }
  async configure(config: SyncConfig): Promise<SyncStatus> {
    return this.exclusive(async () => {
      await configureSync(this.options, await this.metadata(), config);
      return this.status();
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
          title: this.controller.signal.aborted
            ? "同步已取消，已保存内容不受影响"
            : "同步未完成，请重试"
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
      return this.status();
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
        "恢复历史前的版本"
      );
      await this.options.workspace.apply(entry.key, current, entry.item);
      this.state.progress = {
        ...IDLE,
        title: "已恢复到本机，下次手动同步时上传"
      };
      return this.status();
    });
  }
}
