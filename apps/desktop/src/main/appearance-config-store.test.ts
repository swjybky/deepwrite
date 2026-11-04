import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultAppearanceSettings,
  type AppearanceSettings
} from "@deepwrite/contracts";
import { AppearanceConfigStore } from "./appearance-config-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

function customizedSettings(): AppearanceSettings {
  const defaults = createDefaultAppearanceSettings();
  return {
    ...defaults,
    mode: "dark",
    light: {
      ...defaults.light,
      uiFontSize: 16,
      editorFontSize: 22,
      codeFontSize: 14
    },
    dark: {
      ...defaults.dark,
      preset: "custom",
      accent: "#FF8800",
      uiFontSize: 18,
      editorFontSize: 24
    }
  };
}

describe("AppearanceConfigStore", () => {
  it("returns defaults when no persisted file exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-empty-"));
    temporaryRoots.push(root);
    const store = new AppearanceConfigStore(join(root, "user-data"));

    await expect(store.list()).resolves.toEqual({
      persisted: false,
      settings: createDefaultAppearanceSettings()
    });
  });

  it("persists validated settings and reloads them after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-save-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new AppearanceConfigStore(userData);
    const settings = customizedSettings();

    await expect(store.save(settings)).resolves.toEqual({
      persisted: true,
      settings: {
        ...settings,
        dark: {
          ...settings.dark,
          accent: "#FF8800"
        }
      }
    });

    const onDisk = JSON.parse(
      await readFile(join(userData, "config", "appearance.json"), "utf8")
    ) as { version: number };
    expect(onDisk.version).toBe(1);

    const reloaded = new AppearanceConfigStore(userData);
    await expect(reloaded.list()).resolves.toEqual({
      persisted: true,
      settings: {
        ...settings,
        dark: {
          ...settings.dark,
          accent: "#FF8800"
        }
      }
    });
  });

  it("treats malformed files as missing and keeps defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-bad-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new AppearanceConfigStore(userData);
    await store.save(createDefaultAppearanceSettings());
    await writeFile(
      join(userData, "config", "appearance.json"),
      "{ not-json",
      "utf8"
    );

    await expect(store.list()).resolves.toEqual({
      persisted: false,
      settings: createDefaultAppearanceSettings()
    });
  });

  it("rejects invalid font sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-invalid-"));
    temporaryRoots.push(root);
    const store = new AppearanceConfigStore(join(root, "user-data"));
    const settings = customizedSettings();
    settings.light.uiFontSize = 99;

    await expect(store.save(settings)).rejects.toThrow();
  });

  it("continues the write queue after a failed persistence operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-queue-"));
    temporaryRoots.push(root);
    const store = new AppearanceConfigStore(join(root, "user-data"));
    const valid = customizedSettings();
    const invalid = customizedSettings();
    invalid.dark.accent = "not-a-color";

    await expect(store.save(invalid)).rejects.toThrow();
    await expect(store.save(valid)).resolves.toMatchObject({
      persisted: true,
      settings: {
        mode: "dark",
        light: { uiFontSize: 16 }
      }
    });
  });

  it("defaults missing font families from legacy appearance files", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-appearance-legacy-font-")
    );
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new AppearanceConfigStore(userData);
    const defaults = createDefaultAppearanceSettings();
    await mkdir(join(userData, "config"), { recursive: true });
    await writeFile(
      join(userData, "config", "appearance.json"),
      `${JSON.stringify(
        {
          version: 1,
          mode: "dark",
          light: defaults.light,
          dark: defaults.dark
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await expect(store.list()).resolves.toEqual({
      persisted: true,
      settings: {
        ...defaults,
        mode: "dark"
      }
    });
  });

  it("persists selected font families and reloads them", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-appearance-fonts-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new AppearanceConfigStore(userData);
    const settings = {
      ...createDefaultAppearanceSettings(),
      uiFontFamily: "sans" as const,
      editorFontFamily: "kai" as const
    };

    await expect(store.save(settings)).resolves.toEqual({
      persisted: true,
      settings
    });

    const reloaded = new AppearanceConfigStore(userData);
    await expect(reloaded.list()).resolves.toEqual({
      persisted: true,
      settings
    });
  });
});
