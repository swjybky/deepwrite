import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAppearanceSettings } from "@deepwrite/contracts";

vi.mock("../preload/invoke", () => ({
  browserId: (prefix: string) => `${prefix}_test`,
  invokeCommand: vi.fn()
}));

import { invokeCommand } from "../preload/invoke";
import {
  appearance,
  installAppearanceFonts,
  listAppearanceFonts,
  removeAppearanceFont,
  saveAppearance
} from "../preload/appearance-api";

const mockedInvokeCommand = vi.mocked(invokeCommand);
const FONT_ID = `font_${"b".repeat(64)}` as const;

describe("appearance preload API", () => {
  beforeEach(() => {
    mockedInvokeCommand.mockReset();
  });

  it("validates appearance input and sends the save envelope", async () => {
    const settings = createDefaultAppearanceSettings();
    mockedInvokeCommand.mockResolvedValue({ persisted: true, settings });

    await expect(saveAppearance(settings)).resolves.toEqual({
      persisted: true,
      settings
    });
    expect(mockedInvokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "appearance.save",
        payload: settings,
        id: "cmd_appearance_save_test"
      })
    );
  });

  it("passes an explicit native size capture request through the validated envelope", async () => {
    const settings = createDefaultAppearanceSettings();
    mockedInvokeCommand.mockResolvedValue({
      persisted: true,
      settings: { ...settings, startupWindowSize: { width: 1500, height: 950 } }
    });
    const saved = await saveAppearance(settings, {
      captureCurrentWindowSize: true
    });
    expect(mockedInvokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "appearance.save",
        payload: expect.objectContaining({ captureCurrentWindowSize: true })
      })
    );
    expect(saved.settings.startupWindowSize).toEqual({
      width: 1500,
      height: 950
    });
  });

  it("exposes the complete custom-font API with validated results", async () => {
    mockedInvokeCommand
      .mockResolvedValueOnce({ fonts: [] })
      .mockResolvedValueOnce({ status: "canceled" })
      .mockResolvedValueOnce({
        removed: false,
        catalog: { fonts: [] },
        appearance: {
          persisted: true,
          settings: createDefaultAppearanceSettings()
        }
      });

    await expect(listAppearanceFonts()).resolves.toEqual({ fonts: [] });
    await expect(installAppearanceFonts()).resolves.toEqual({
      status: "canceled"
    });
    await expect(removeAppearanceFont(FONT_ID)).resolves.toMatchObject({
      removed: false,
      catalog: { fonts: [] }
    });

    expect(appearance.fonts.list).toBe(listAppearanceFonts);
    expect(appearance.fonts.install).toBe(installAppearanceFonts);
    expect(appearance.fonts.remove).toBe(removeAppearanceFont);
    expect(
      mockedInvokeCommand.mock.calls.map(([envelope]) => envelope)
    ).toEqual([
      expect.objectContaining({ type: "appearance.fonts.list", payload: {} }),
      expect.objectContaining({
        type: "appearance.fonts.install",
        payload: {}
      }),
      expect.objectContaining({
        type: "appearance.fonts.remove",
        payload: { id: FONT_ID }
      })
    ]);
  });

  it("rejects invalid font ids before invoking main", async () => {
    await expect(
      removeAppearanceFont("font_invalid" as typeof FONT_ID)
    ).rejects.toThrow();
    expect(mockedInvokeCommand).not.toHaveBeenCalled();
  });
});
