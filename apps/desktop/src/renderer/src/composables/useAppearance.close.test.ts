import { initializeTestTranslations } from "../../../test-utils/rendererI18n";
import { createDefaultAppearanceSettings } from "@deepwrite/contracts/renderer";
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
  const save = vi.fn(async () => ({
    settings: createDefaultAppearanceSettings(),
    persisted: true
  }));
  vi.stubGlobal("window", {
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
  });
  const { useAppearance } = await import("./useAppearance");
  const appearance = useAppearance();
  await appearance.whenReady();
  return { appearance, save };
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
