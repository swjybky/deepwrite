import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppearanceSettings,
  type AppearanceCustomFontId,
  type AppearanceFontInstallResult
} from "@deepwrite/contracts";
import { AppearanceConfigStore } from "./appearance-config-store";
import { AppearanceFontStore } from "./appearance-font-store";
import {
  AppearanceFontUnavailableError,
  AppearanceService
} from "./appearance-service";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function setup(): Promise<{
  root: string;
  source: string;
  userData: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-service-"));
  temporaryRoots.push(root);
  const sourceDirectory = join(root, "input");
  await mkdir(sourceDirectory);
  const source = join(sourceDirectory, "Local Font.ttf");
  await writeFile(source, Buffer.from([0x00, 0x01, 0x00, 0x00, 0x07]));
  return { root, source, userData: join(root, "user-data") };
}

function installedId(result: AppearanceFontInstallResult) {
  expect(result.status).toBe("completed");
  if (result.status === "canceled") throw new Error("unexpected cancellation");
  return result.installedIds[0]!;
}

describe("AppearanceService", () => {
  it("persists selections only after their custom font is installed", async () => {
    const { source, userData } = await setup();
    const service = new AppearanceService(userData);
    const id = installedId(await service.installFonts([source]));
    const settings = {
      ...createDefaultAppearanceSettings(),
      uiFontFamily: id,
      editorFontFamily: id
    };

    await expect(service.save(settings)).resolves.toEqual({
      persisted: true,
      settings
    });
    await expect(new AppearanceService(userData).list()).resolves.toEqual({
      persisted: true,
      settings
    });
  });

  it("rejects a valid custom id that is not in the font catalog", async () => {
    const { userData } = await setup();
    const service = new AppearanceService(userData);
    const missing = `font_${"f".repeat(64)}` as AppearanceCustomFontId;

    await expect(
      service.save({
        ...createDefaultAppearanceSettings(),
        uiFontFamily: missing
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AppearanceFontUnavailableError>>({
        code: "appearance.custom_font_unavailable",
        fontId: missing
      })
    );
    await expect(
      service.save(createDefaultAppearanceSettings())
    ).resolves.toEqual({
      persisted: true,
      settings: createDefaultAppearanceSettings()
    });
  });

  it("falls back and persists before deleting a selected font", async () => {
    const { source, userData } = await setup();
    const service = new AppearanceService(userData);
    const id = installedId(await service.installFonts([source]));
    await service.save({
      ...createDefaultAppearanceSettings(),
      mode: "dark",
      uiFontFamily: id,
      editorFontFamily: id
    });

    await expect(service.removeFont(id)).resolves.toMatchObject({
      removed: true,
      catalog: { fonts: [] },
      appearance: {
        persisted: true,
        settings: {
          mode: "dark",
          uiFontFamily: "system",
          editorFontFamily: "song"
        }
      }
    });
    await expect(new AppearanceService(userData).list()).resolves.toMatchObject(
      {
        settings: { uiFontFamily: "system", editorFontFamily: "song" }
      }
    );
  });

  it("repairs persisted selections whose private font asset is missing", async () => {
    const { userData } = await setup();
    const missing = `font_${"a".repeat(64)}` as AppearanceCustomFontId;
    await new AppearanceConfigStore(userData).save({
      ...createDefaultAppearanceSettings(),
      mode: "light",
      uiFontFamily: missing,
      editorFontFamily: missing
    });

    await expect(new AppearanceService(userData).list()).resolves.toMatchObject(
      {
        persisted: true,
        settings: {
          mode: "light",
          uiFontFamily: "system",
          editorFontFamily: "song"
        }
      }
    );
    await expect(
      new AppearanceConfigStore(userData).list()
    ).resolves.toMatchObject({
      settings: { uiFontFamily: "system", editorFontFamily: "song" }
    });
  });

  it("keeps an unselected appearance unchanged when deleting a font", async () => {
    const { source, userData } = await setup();
    const service = new AppearanceService(userData);
    const id = installedId(await service.installFonts([source]));
    const appearance = await service.save({
      ...createDefaultAppearanceSettings(),
      mode: "dark"
    });

    await expect(service.removeFont(id)).resolves.toEqual({
      removed: true,
      catalog: { fonts: [] },
      appearance
    });
  });

  it("does not delete a selected font when persisting its fallback fails", async () => {
    const { userData } = await setup();
    const missing = `font_${"c".repeat(64)}` as AppearanceCustomFontId;
    const settings = {
      ...createDefaultAppearanceSettings(),
      uiFontFamily: missing
    };
    const configStore = new AppearanceConfigStore(userData);
    vi.spyOn(configStore, "list").mockResolvedValue({
      persisted: true,
      settings
    });
    vi.spyOn(configStore, "save").mockRejectedValue(
      new Error("persistence failed")
    );
    const fontStore = new AppearanceFontStore(userData);
    vi.spyOn(fontStore, "list").mockResolvedValue({
      fonts: [
        {
          id: missing,
          displayName: "Selected",
          format: "ttf",
          byteSize: 5,
          installedAt: "2026-08-24T00:00:00.000Z"
        }
      ]
    });
    const remove = vi.spyOn(fontStore, "remove");
    const service = new AppearanceService(userData, {
      appearanceConfigStore: configStore,
      appearanceFontStore: fontStore
    });

    await expect(service.removeFont(missing)).rejects.toThrow(
      "persistence failed"
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
