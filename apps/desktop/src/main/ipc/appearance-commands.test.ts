import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createDefaultAppearanceSettings,
  createEnvelope,
  type AppearanceCustomFont,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";
import {
  handleAppearanceCommands,
  type AppearanceCommandContext
} from "./appearance-commands";

const FONT_ID = `font_${"a".repeat(64)}` as const;
const font: AppearanceCustomFont = {
  id: FONT_ID,
  displayName: "示例字体",
  format: "ttf",
  byteSize: 1024,
  installedAt: "2026-08-24T00:00:00.000Z"
};

function appearanceSnapshot(
  overrides: Partial<AppearanceSettingsSnapshot["settings"]> = {}
): AppearanceSettingsSnapshot {
  return {
    persisted: true,
    settings: { ...createDefaultAppearanceSettings(), ...overrides }
  };
}

function command(
  type:
    | "appearance.list"
    | "appearance.save"
    | "appearance.fonts.list"
    | "appearance.fonts.install"
    | "appearance.fonts.remove",
  payload: Record<string, unknown> = {}
) {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: `cmd_${type.replaceAll(".", "_")}` })
  );
}

function context(overrides: Record<string, unknown>): AppearanceCommandContext {
  return {
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    },
    getMainWindow: vi.fn(() => ({})),
    requireAppearanceService: vi.fn(() => ({})),
    syncNativeAppearanceChrome: vi.fn(),
    ...overrides
  } as unknown as AppearanceCommandContext;
}

describe("appearance commands", () => {
  it("lists and saves appearance through the shared service", async () => {
    const listed = appearanceSnapshot();
    const saved = appearanceSnapshot({ uiFontFamily: FONT_ID });
    const list = vi.fn(async () => listed);
    const save = vi.fn(async () => saved);
    const syncNativeAppearanceChrome = vi.fn();
    const ctx = context({
      requireAppearanceService: () => ({ list, save }),
      syncNativeAppearanceChrome
    });

    await expect(
      handleAppearanceCommands(ctx, command("appearance.list"))
    ).resolves.toMatchObject({ status: "accepted", payload: listed });
    await expect(
      handleAppearanceCommands(ctx, command("appearance.save", saved.settings))
    ).resolves.toMatchObject({ status: "accepted", payload: saved });

    expect(save).toHaveBeenCalledWith(saved.settings);
    expect(syncNativeAppearanceChrome).toHaveBeenNthCalledWith(
      1,
      listed.settings
    );
    expect(syncNativeAppearanceChrome).toHaveBeenNthCalledWith(
      2,
      saved.settings
    );
  });

  it("captures native window size only on an explicit request", async () => {
    const getBounds = vi.fn(() => ({ x: 20, y: 40, width: 1500, height: 950 }));
    const save = vi.fn(async (settings) => ({ persisted: true, settings }));
    const ctx = context({
      getMainWindow: () => ({ getBounds }),
      requireAppearanceService: () => ({ save })
    });
    const settings = createDefaultAppearanceSettings();
    const captured = await handleAppearanceCommands(
      ctx,
      command("appearance.save", {
        ...settings,
        captureCurrentWindowSize: true
      })
    );
    expect(captured).toMatchObject({
      status: "accepted",
      payload: { settings: { startupWindowSize: { width: 1500, height: 950 } } }
    });
    expect(save.mock.calls[0]![0]).not.toHaveProperty(
      "captureCurrentWindowSize"
    );
    getBounds.mockClear();
    await handleAppearanceCommands(
      ctx,
      command("appearance.save", {
        ...settings,
        startupWindowSize: { width: 1500, height: 950 }
      })
    );
    expect(getBounds).not.toHaveBeenCalled();
    await handleAppearanceCommands(
      ctx,
      command("appearance.save", { ...settings, startupWindowSize: null })
    );
    expect(save.mock.calls.at(-1)![0].startupWindowSize).toBeNull();
  });

  it("returns a canceled result without asking the service to install", async () => {
    const installFonts = vi.fn();
    const showOpenDialog = vi.fn(async () => ({
      canceled: true,
      filePaths: []
    }));
    const ctx = context({
      dialog: { showOpenDialog },
      requireAppearanceService: () => ({ installFonts })
    });

    await expect(
      handleAppearanceCommands(ctx, command("appearance.fonts.install"))
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { status: "canceled" }
    });
    expect(installFonts).not.toHaveBeenCalled();
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: [{ name: "字体文件", extensions: ["ttf", "otf"] }],
        properties: ["openFile", "multiSelections"]
      })
    );
  });

  it("passes selected font paths only to the service for bounded processing", async () => {
    const filePaths = ["/virtual/example.ttf", "/virtual/example.otf"];
    const installFonts = vi.fn(async () => ({
      status: "completed" as const,
      catalog: { fonts: [font] },
      installedIds: [FONT_ID],
      duplicateIds: [],
      rejected: []
    }));
    const ctx = context({
      dialog: {
        showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths }))
      },
      requireAppearanceService: () => ({ installFonts })
    });

    await expect(
      handleAppearanceCommands(ctx, command("appearance.fonts.install"))
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { status: "completed", installedIds: [FONT_ID] }
    });
    expect(installFonts).toHaveBeenCalledWith(filePaths);

    const tooManyPaths = Array.from(
      { length: 21 },
      (_, index) => `/virtual/font-${index}.ttf`
    );
    const limitedCtx = context({
      dialog: {
        showOpenDialog: vi.fn(async () => ({
          canceled: false,
          filePaths: tooManyPaths
        }))
      },
      requireAppearanceService: () => ({ installFonts })
    });
    await expect(
      handleAppearanceCommands(limitedCtx, command("appearance.fonts.install"))
    ).resolves.toMatchObject({ status: "accepted" });
    expect(installFonts).toHaveBeenNthCalledWith(2, tooManyPaths);
  });

  it("syncs fallback appearance after removing a selected font", async () => {
    const appearance = appearanceSnapshot();
    const removeFont = vi.fn(async () => ({
      removed: true,
      catalog: { fonts: [] },
      appearance
    }));
    const syncNativeAppearanceChrome = vi.fn();
    const ctx = context({
      requireAppearanceService: () => ({ removeFont }),
      syncNativeAppearanceChrome
    });

    await expect(
      handleAppearanceCommands(
        ctx,
        command("appearance.fonts.remove", { id: FONT_ID })
      )
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { removed: true, appearance }
    });
    expect(removeFont).toHaveBeenCalledWith(FONT_ID);
    expect(syncNativeAppearanceChrome).toHaveBeenCalledWith(
      appearance.settings
    );
  });

  it("does not expose backend paths in font command errors", async () => {
    const ctx = context({
      requireAppearanceService: () => ({
        listFonts: vi.fn(async () => {
          throw new Error("Could not read /private/example.ttf");
        })
      })
    });

    await expect(
      handleAppearanceCommands(ctx, command("appearance.fonts.list"))
    ).resolves.toEqual({
      status: "rejected",
      requestId: "cmd_appearance_fonts_list",
      error: {
        code: "appearance.fonts.list_failed",
        message: "加载本地字体失败。",
        details: { kind: "Error" }
      }
    });
  });
});
