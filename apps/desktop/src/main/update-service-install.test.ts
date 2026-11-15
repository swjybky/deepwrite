import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => {
  const listeners = new Map<string, (payload?: unknown) => void>();
  return {
    appVersion: "1.0.0",
    listeners,
    on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
      listeners.set(event, listener);
    }),
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    setFeedURL: vi.fn()
  };
});

vi.mock("electron", () => ({
  app: {
    getVersion: () => updaterMocks.appVersion,
    isPackaged: true
  },
  net: {
    fetch: vi.fn()
  }
}));

vi.mock("electron-updater", () => ({
  autoUpdater: updaterMocks
}));

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpdateService, type UpdateServiceOptions } from "./update-service";

let directory: string;
let markerPath: string;

function options(
  overrides: Partial<UpdateServiceOptions> = {}
): UpdateServiceOptions {
  return {
    installMarkerPath: markerPath,
    confirmInstall: async () => true,
    ...overrides
  };
}

describe("UpdateService install handoff", () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "deepwrite-update-"));
    markerPath = join(directory, "update-install.json");
    updaterMocks.appVersion = "1.0.0";
    updaterMocks.listeners.clear();
    updaterMocks.on.mockClear();
    updaterMocks.quitAndInstall.mockClear();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("publishes an installing state before requesting application shutdown", async () => {
    const states: string[] = [];
    const requestInstall = vi.fn(() => {
      states.push(service.getState().status);
    });
    const service = new UpdateService(requestInstall, options());
    service.subscribe((state) => states.push(state.status));

    updaterMocks.listeners.get("update-downloaded")?.();
    await service.install();

    expect(requestInstall).toHaveBeenCalledOnce();
    expect(states).toContain("downloaded");
    expect(states.at(-2)).toBe("installing");
    expect(states.at(-1)).toBe("installing");
    expect(service.getState()).toMatchObject({
      status: "installing",
      canDownload: false,
      canInstall: false
    });
  });

  it("keeps the downloaded update retryable if handoff fails synchronously", async () => {
    const service = new UpdateService(() => {
      throw new Error("handoff failed");
    }, options());
    updaterMocks.listeners.get("update-downloaded")?.();

    await expect(service.install()).rejects.toThrow("handoff failed");
    expect(service.getState()).toMatchObject({
      status: "error",
      canDownload: false,
      canInstall: true,
      message: "handoff failed"
    });
  });

  it("keeps installation retryable when the native updater reports an error", async () => {
    const service = new UpdateService(() => undefined, options());
    updaterMocks.listeners.get("update-downloaded")?.();
    await service.install();

    updaterMocks.listeners.get("error")?.(new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "error",
      canDownload: false,
      canInstall: true,
      message: "native install failed"
    });
  });

  it("stays downloaded when the user declines to install yet", async () => {
    const requestInstall = vi.fn();
    const service = new UpdateService(
      requestInstall,
      options({ confirmInstall: async () => false })
    );
    updaterMocks.listeners.get("update-downloaded")?.();

    await service.install();

    expect(requestInstall).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      status: "downloaded",
      canInstall: true
    });
  });

  it("asks only once when install is requested again while asking", async () => {
    let answer: (value: boolean) => void = () => undefined;
    const confirmInstall = vi.fn(
      () => new Promise<boolean>((resolve) => (answer = resolve))
    );
    const requestInstall = vi.fn();
    const service = new UpdateService(
      requestInstall,
      options({ confirmInstall })
    );
    updaterMocks.listeners.get("update-downloaded")?.();

    const first = service.install();
    await service.install();
    answer(true);
    await first;

    expect(confirmInstall).toHaveBeenCalledOnce();
    expect(requestInstall).toHaveBeenCalledOnce();
  });

  it("reports an update that left the old version installed", async () => {
    await writeFile(markerPath, JSON.stringify({ version: "1.1.0" }));
    const service = new UpdateService(() => undefined, options());

    expect(service.takeFailedInstall()).toBe("1.1.0");
    expect(service.getState()).toMatchObject({
      status: "error",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      canInstall: false
    });
    expect(service.takeFailedInstall()).toBeUndefined();
  });

  it("forgets the record once the new version is running", async () => {
    await writeFile(markerPath, JSON.stringify({ version: "1.1.0" }));
    updaterMocks.appVersion = "1.1.0";
    const service = new UpdateService(() => undefined, options());

    expect(service.takeFailedInstall()).toBeUndefined();
    expect(service.getState().status).toBe("idle");
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("records the version being installed before the installer starts", async () => {
    await writeFile(markerPath, JSON.stringify({ version: "1.1.0" }));
    const service = new UpdateService(() => undefined, options());
    service.takeFailedInstall();

    service.quitAndInstall();

    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual({
      version: "1.1.0"
    });
  });

  it("ignores a damaged record", async () => {
    await writeFile(markerPath, "{not json");
    const service = new UpdateService(() => undefined, options());

    expect(service.takeFailedInstall()).toBeUndefined();
  });
});
