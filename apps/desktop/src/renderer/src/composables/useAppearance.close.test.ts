import { initializeTestTranslations } from "../../../test-utils/rendererI18n";
import {
  createDefaultAppearanceSettings,
  type AppearanceSettings
} from "@deepwrite/contracts/renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./appearanceThemeRuntime", async (original) => ({
  ...(await original<typeof import("./appearanceThemeRuntime")>()),
  applyAppearanceThemeToDocument: vi.fn()
}));
vi.mock("./useAppearanceFonts", () => ({
  ensureAppearanceFontLoaded: vi.fn(async () => undefined),
  hydrateAppearanceFontCatalog: vi.fn(async () => undefined)
}));

beforeEach(async () => {
  vi.resetModules();
  await initializeTestTranslations();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const listeners = new Map<string, Set<() => void>>();
  const save = vi.fn(
    async (
      _settings: AppearanceSettings,
      _options?: { captureCurrentWindowSize?: boolean }
    ) => ({
      settings: createDefaultAppearanceSettings(),
      persisted: true
    })
  );
  const mockWindow = {
    outerWidth: 1200,
    outerHeight: 800,
    addEventListener: vi.fn((event: string, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    }),
    localStorage: {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn()
    },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    deepwrite: {
      appearance: {
        list: async () => ({
          settings: createDefaultAppearanceSettings(),
          persisted: true
        }),
        save
      }
    }
  };
  vi.stubGlobal("window", mockWindow);
  const { useAppearance } = await import("./useAppearance");
  const appearance = useAppearance();
  await appearance.whenReady();
  return {
    appearance,
    save,
    triggerResize(width: number, height: number) {
      mockWindow.outerWidth = width;
      mockWindow.outerHeight = height;
      for (const listener of listeners.get("resize") ?? []) {
        listener();
      }
    }
  };
}

describe("appearance persistence before close", () => {
  it("flushes the latest theme without waiting for the debounce timer", async () => {
    const { appearance, save } = await setup();
    appearance.setMode("dark");
    await appearance.flush();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "dark" })
    );
  });

  it("keeps the captured startup size when changing other appearance settings", async () => {
    const { appearance, save } = await setup();
    const size = { width: 1500, height: 950 };
    save.mockImplementation(async () => ({
      persisted: true,
      settings: {
        ...createDefaultAppearanceSettings(),
        startupWindowSize: size
      }
    }));
    await appearance.saveStartupWindowSize(true);
    expect(save).toHaveBeenCalledWith(expect.anything(), {
      captureCurrentWindowSize: true
    });
    expect(appearance.state.startupWindowSize).toEqual(size);
    appearance.setMode("dark");
    await appearance.flush();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "dark", startupWindowSize: size })
    );
    save.mockImplementation(async () => ({
      persisted: true,
      settings: {
        ...createDefaultAppearanceSettings(),
        startupWindowSize: null
      }
    }));
    await appearance.saveStartupWindowSize(false);
    expect(appearance.state.startupWindowSize).toBeNull();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ startupWindowSize: null }),
      { captureCurrentWindowSize: false }
    );
  });

  it("keeps the previous size when saving a new size fails", async () => {
    const { appearance, save } = await setup();
    await appearance.flush();
    save.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(appearance.saveStartupWindowSize(true)).rejects.toThrow(
      "disk unavailable"
    );
    expect(appearance.state.startupWindowSize).toBeUndefined();
  });

  it("automatically captures window size on resize by default and stops after switching to default size", async () => {
    const { appearance, save, triggerResize } = await setup();
    let capturedSize = { width: 1200, height: 800 };
    save.mockImplementation(async (settings, options) => ({
      persisted: true,
      settings: {
        ...settings,
        startupWindowSize: options?.captureCurrentWindowSize
          ? capturedSize
          : settings.startupWindowSize
      }
    }));

    capturedSize = { width: 1440, height: 920 };
    triggerResize(1440, 920);
    expect(appearance.state.startupWindowSize).toEqual({
      width: 1440,
      height: 920
    });
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startupWindowSize: { width: 1440, height: 920 }
      }),
      { captureCurrentWindowSize: true }
    );

    capturedSize = { width: 1500, height: 960 };
    triggerResize(1500, 960);
    await appearance.flush();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startupWindowSize: { width: 1500, height: 960 }
      }),
      { captureCurrentWindowSize: true }
    );

    await appearance.saveStartupWindowSize(false);
    expect(appearance.state.startupWindowSize).toBeNull();
    save.mockClear();

    triggerResize(1600, 1000);
    await vi.advanceTimersByTimeAsync(300);
    await appearance.flush();
    expect(appearance.state.startupWindowSize).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("blocks close on failed persistence and retries without discarding the live theme", async () => {
    const { appearance, save } = await setup();
    save.mockRejectedValueOnce(new Error("disk unavailable"));
    appearance.setMode("dark");
    await expect(appearance.flush()).rejects.toThrow("外观设置尚未保存");
    expect(appearance.state.mode).toBe("dark");
    await expect(appearance.flush()).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
