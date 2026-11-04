import { app, net } from "electron";
import {
  autoUpdater as nativeAutoUpdater,
  type ProgressInfo
} from "electron-updater";
import {
  UPDATE_MANIFEST_URL,
  UpdateManifestSchema,
  UpdateStateSchema,
  type UpdateManifest,
  type UpdateState
} from "@deepwrite/contracts";
import { compareVersions } from "./update-version";
import { createUpdateServiceUpdater } from "./arch-package-updater";

const autoUpdater = createUpdateServiceUpdater(nativeAutoUpdater);

type UpdateStateListener = (state: UpdateState) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "检查更新时发生未知错误";
}

export class UpdateService {
  private state: UpdateState;
  private manifest: UpdateManifest | undefined;
  private readonly listeners = new Set<UpdateStateListener>();
  private checkPromise: Promise<UpdateState> | undefined;
  private downloadPromise: Promise<UpdateState> | undefined;

  constructor(private readonly requestInstall: () => void) {
    this.state = UpdateStateSchema.parse({
      status: "idle",
      currentVersion: app.getVersion(),
      releaseNotes: [],
      mandatory: false,
      canDownload: false,
      canInstall: false
    });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      this.patchState({
        status: "downloading",
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        canDownload: false,
        canInstall: false
      });
    });
    autoUpdater.on("update-downloaded", () => {
      this.patchState({
        status: "downloaded",
        percent: 100,
        canDownload: false,
        canInstall: true,
        message: "新版本已经下载完成，可以重启安装。"
      });
    });
    autoUpdater.on("error", (error: Error) => {
      const canRetryInstall =
        this.state.status === "downloaded" ||
        this.state.status === "installing";
      this.patchState({
        status: "error",
        canDownload: !canRetryInstall && Boolean(this.manifest),
        canInstall: canRetryInstall,
        message: errorMessage(error)
      });
    });
  }

  getState(): UpdateState {
    return UpdateStateSchema.parse(this.state);
  }

  subscribe(listener: UpdateStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  check(): Promise<UpdateState> {
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck().finally(() => {
      this.checkPromise = undefined;
    });
    return this.checkPromise;
  }

  private async performCheck(): Promise<UpdateState> {
    this.replaceState({
      status: "checking",
      currentVersion: app.getVersion(),
      releaseNotes: [],
      mandatory: false,
      canDownload: false,
      canInstall: false,
      message: "正在连接更新服务器…"
    });
    try {
      const response = await net.fetch(UPDATE_MANIFEST_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        throw new Error(`更新清单请求失败（HTTP ${response.status}）`);
      }
      const manifest = UpdateManifestSchema.parse(await response.json());
      this.manifest = undefined;
      if (
        !manifest.enabled ||
        compareVersions(manifest.version, app.getVersion()) <= 0
      ) {
        return this.replaceState({
          status: "not-available",
          currentVersion: app.getVersion(),
          latestVersion: manifest.version,
          title: manifest.title,
          releaseNotes: manifest.releaseNotes,
          mandatory: false,
          releasePage: manifest.releasePage,
          canDownload: false,
          canInstall: false,
          message: "当前已是最新版本。"
        });
      }

      const mandatory =
        manifest.mandatory ||
        Boolean(
          manifest.minimumSupportedVersion &&
          compareVersions(app.getVersion(), manifest.minimumSupportedVersion) <
            0
        );
      this.manifest = manifest;
      const availableState = {
        status: "available" as const,
        currentVersion: app.getVersion(),
        latestVersion: manifest.version,
        title: manifest.title,
        releaseNotes: manifest.releaseNotes,
        mandatory,
        releasePage: manifest.releasePage,
        canDownload: app.isPackaged,
        canInstall: false,
        message: app.isPackaged
          ? "发现新版本，可以开始后台下载。"
          : "开发模式只能检查更新，请使用安装后的测试包验证下载和安装。"
      };
      if (!app.isPackaged) {
        return this.replaceState({ ...availableState, status: "unsupported" });
      }

      // Historical 1.6.3xx builds preceded 1.6.4. Permit that upgrade when
      // the native updater considers the accepted version numerically older.
      autoUpdater.allowDowngrade =
        autoUpdater.currentVersion.compare(manifest.version) > 0;
      autoUpdater.setFeedURL({
        provider: "generic",
        url: manifest.feedUrl,
        ...(process.platform === "win32" && process.arch === "arm64"
          ? { channel: "latest-arm64" }
          : {})
      });
      const result = await autoUpdater.checkForUpdates();
      if (!result?.updateInfo) {
        throw new Error("GitHub Release 没有返回可用的更新信息。");
      }
      if (result.updateInfo.version !== manifest.version) {
        throw new Error(
          `update.json 版本 ${manifest.version} 与 Release 更新清单版本 ${result.updateInfo.version} 不一致。`
        );
      }
      if (!result.isUpdateAvailable) {
        throw new Error("更新器未能准备可下载的更新，请稍后重试。");
      }
      return this.replaceState(availableState);
    } catch (error: unknown) {
      return this.replaceState({
        status: "error",
        currentVersion: app.getVersion(),
        releaseNotes: [],
        mandatory: false,
        canDownload: false,
        canInstall: false,
        message: errorMessage(error)
      });
    }
  }

  download(): Promise<UpdateState> {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.performDownload().finally(() => {
      this.downloadPromise = undefined;
    });
    return this.downloadPromise;
  }

  private async performDownload(): Promise<UpdateState> {
    if (!app.isPackaged) throw new Error("开发模式不能下载安装包。");
    if (!this.manifest || !this.state.canDownload) {
      throw new Error("请先检查更新，再开始下载。");
    }
    this.patchState({
      status: "downloading",
      percent: 0,
      transferred: 0,
      total: undefined,
      bytesPerSecond: 0,
      canDownload: false,
      canInstall: false,
      message: "正在后台下载新版本…"
    });
    try {
      await autoUpdater.downloadUpdate();
      return this.getState();
    } catch (error: unknown) {
      return this.patchState({
        status: "error",
        canDownload: true,
        canInstall: false,
        message: errorMessage(error)
      });
    }
  }

  install(): void {
    if (this.state.status !== "downloaded") {
      throw new Error("更新尚未下载完成。");
    }
    this.patchState({
      status: "installing",
      canDownload: false,
      canInstall: false,
      message: "正在安全退出并准备安装，请稍候…"
    });
    try {
      this.requestInstall();
    } catch (error: unknown) {
      this.patchState({
        status: "error",
        canDownload: false,
        canInstall: true,
        message: errorMessage(error)
      });
      throw error;
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  private replaceState(state: UpdateState): UpdateState {
    this.state = UpdateStateSchema.parse(state);
    this.emit();
    return this.getState();
  }

  private patchState(patch: Partial<UpdateState>): UpdateState {
    this.state = UpdateStateSchema.parse({ ...this.state, ...patch });
    this.emit();
    return this.getState();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}
