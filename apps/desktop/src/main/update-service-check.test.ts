import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  currentVersion: "1.6.303",
  manifestVersion: "1.6.4",
  feedVersion: "1.6.4",
  enabled: true,
  supported: true,
  minimumSupportedVersion: undefined as string | undefined,
  downloadedVersions: [] as string[]
}));

vi.mock("electron", () => ({
  app: { getVersion: () => runtime.currentVersion, isPackaged: true },
  net: {
    fetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        enabled: runtime.enabled,
        version: runtime.manifestVersion,
        title: "DeepWrite update",
        publishedAt: "2026-10-10T00:00:00Z",
        releaseNotes: [],
        minimumSupportedVersion: runtime.minimumSupportedVersion,
        releasePage: "https://example.test/releases",
        feedUrl: "https://example.test/updates"
      })
    }))
  }
}));

vi.mock("electron-updater", async () => {
  const { NsisUpdater } = await vi.importActual<
    typeof import("electron-updater/out/NsisUpdater")
  >("electron-updater/out/NsisUpdater");
  const updater = new NsisUpdater(undefined, {
    version: "1.6.303",
    name: "DeepWrite test",
    isPackaged: true,
    appUpdateConfigPath: "unused-test-config.yml",
    userDataPath: "unused-test-profile",
    baseCachePath: "unused-test-cache",
    whenReady: async () => undefined,
    relaunch: () => undefined,
    quit: () => undefined,
    onQuit: () => undefined
  });
  updater.logger = null;
  updater.isUpdateSupported = () => runtime.supported;
  vi.spyOn(updater, "setFeedURL").mockImplementation(() => undefined);
  // Keep the real updater's version checks and download admission, replacing
  // only feed/network access and the native installer download.
  Object.defineProperty(updater, "getUpdateInfoAndProvider", {
    value: async () => ({
      info: { version: runtime.feedVersion, files: [] },
      provider: {}
    })
  });
  Object.defineProperty(updater, "doDownloadUpdate", {
    value: async (options: {
      updateInfoAndProvider: { info: { version: string } };
    }) => {
      const version = options.updateInfoAndProvider.info.version;
      runtime.downloadedVersions.push(version);
      updater.emit("update-downloaded", {
        version,
        files: [],
        path: "DeepWrite-test.exe",
        sha512: "invalid-test-checksum",
        releaseDate: "2026-10-10T00:00:00Z",
        downloadedFile: "unused-test-installer.exe"
      });
      return [];
    }
  });
  return { autoUpdater: updater };
});

import { autoUpdater } from "electron-updater";
import { UpdateService } from "./update-service";

describe("UpdateService version ordering", () => {
  beforeEach(() => {
    runtime.currentVersion = "1.6.303";
    runtime.manifestVersion = "1.6.4";
    runtime.feedVersion = "1.6.4";
    runtime.enabled = true;
    runtime.supported = true;
    runtime.minimumSupportedVersion = undefined;
    runtime.downloadedVersions.length = 0;
    autoUpdater.removeAllListeners();
    vi.mocked(autoUpdater.setFeedURL).mockClear();
  });

  it("admits and downloads 1.6.4 from 1.6.303 through the real updater", async () => {
    const service = new UpdateService(() => undefined);

    expect(await service.check()).toMatchObject({
      status: "available",
      currentVersion: "1.6.303",
      latestVersion: "1.6.4",
      canDownload: true
    });
    expect(autoUpdater.allowDowngrade).toBe(true);
    expect(await service.download()).toMatchObject({
      status: "downloaded",
      canDownload: false,
      canInstall: true
    });
    expect(runtime.downloadedVersions).toEqual(["1.6.4"]);
  });

  it.each([
    ["win32", "arm64", "latest-arm64"],
    ["win32", "x64", undefined],
    ["darwin", "arm64", undefined]
  ])(
    "selects the matching update channel on %s/%s",
    async (platform, arch, channel) => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(
        process,
        "platform"
      )!;
      const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch")!;
      try {
        Object.defineProperty(process, "platform", { value: platform });
        Object.defineProperty(process, "arch", { value: arch });
        const service = new UpdateService(() => undefined);
        expect(await service.check()).toMatchObject({ status: "available" });
        expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
          provider: "generic",
          url: "https://example.test/updates",
          ...(channel ? { channel } : {})
        });
      } finally {
        Object.defineProperty(process, "platform", platformDescriptor);
        Object.defineProperty(process, "arch", archDescriptor);
      }
    }
  );

  it.each(["1.6.2", "1.6.3", "1.6.302", "1.6.303"])(
    "blocks older or equal %s before reaching the updater",
    async (version) => {
      runtime.manifestVersion = version;
      const service = new UpdateService(() => undefined);

      expect(await service.check()).toMatchObject({
        status: "not-available",
        canDownload: false
      });
      expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
      await expect(service.download()).rejects.toThrow("请先检查更新");
    }
  );

  it.each(["1.7.9", "1.7.10", "1.7.11"])(
    "does not offer %s when 1.7.11 is already installed",
    async (version) => {
      runtime.currentVersion = "1.7.11";
      runtime.manifestVersion = version;
      const service = new UpdateService(() => undefined);
      expect(await service.check()).toMatchObject({
        status: "not-available",
        canDownload: false
      });
      expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    }
  );

  it("clears native downgrade permission for a subsequent numeric upgrade", async () => {
    const service = new UpdateService(() => undefined);
    await service.check();
    expect(autoUpdater.allowDowngrade).toBe(true);

    runtime.manifestVersion = "1.6.304";
    runtime.feedVersion = "1.6.304";
    expect(await service.check()).toMatchObject({ status: "available" });
    expect(autoUpdater.allowDowngrade).toBe(false);
  });

  it("uses legacy build compatibility to enforce the minimum supported version", async () => {
    runtime.minimumSupportedVersion = "1.6.4";
    const service = new UpdateService(() => undefined);
    expect(await service.check()).toMatchObject({
      status: "available",
      mandatory: true
    });
  });

  it("requires matching release metadata before enabling downloads", async () => {
    runtime.feedVersion = "1.6.5";
    const service = new UpdateService(() => undefined);

    expect(await service.check()).toMatchObject({
      status: "error",
      canDownload: false,
      message: expect.stringContaining("不一致")
    });
  });

  it("keeps downloads disabled when the native updater rejects the update", async () => {
    runtime.supported = false;
    const service = new UpdateService(() => undefined);

    expect(await service.check()).toMatchObject({
      status: "error",
      canDownload: false,
      message: "更新器未能准备可下载的更新，请稍后重试。"
    });
  });

  it("keeps updates disabled when the manifest is disabled", async () => {
    runtime.enabled = false;
    const service = new UpdateService(() => undefined);
    expect(await service.check()).toMatchObject({ status: "not-available" });
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });
});
