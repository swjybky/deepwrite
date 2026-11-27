import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppearanceSettingsSchema,
  AppearanceSettingsSnapshotSchema,
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";
import { writeJsonAtomic, isNodeError } from "@deepwrite/shared/node";

interface DiskAppearanceSettings {
  version: 1;
  startupWindowSize?: AppearanceSettings["startupWindowSize"];
  mode: AppearanceSettings["mode"];
  light: AppearanceSettings["light"];
  dark: AppearanceSettings["dark"];
  uiFontFamily?: AppearanceSettings["uiFontFamily"];
  editorFontFamily?: AppearanceSettings["editorFontFamily"];
}

function toPublicSettings(raw: unknown): AppearanceSettings {
  return AppearanceSettingsSchema.parse(raw);
}

export class AppearanceConfigStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "appearance.json");
  }

  async list(): Promise<AppearanceSettingsSnapshot> {
    await this.writeChain;
    try {
      const raw = JSON.parse(
        await readFile(this.settingsPath, "utf8")
      ) as unknown;
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("version" in raw) ||
        (raw as { version?: unknown }).version !== 1
      ) {
        return AppearanceSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultAppearanceSettings()
        });
      }
      const candidate = raw as DiskAppearanceSettings;
      return AppearanceSettingsSnapshotSchema.parse({
        persisted: true,
        settings: toPublicSettings({
          startupWindowSize: candidate.startupWindowSize,
          mode: candidate.mode,
          light: candidate.light,
          dark: candidate.dark,
          uiFontFamily: candidate.uiFontFamily,
          editorFontFamily: candidate.editorFontFamily
        })
      });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return AppearanceSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultAppearanceSettings()
        });
      }
      throw error;
    }
  }

  async save(
    rawInput: AppearanceSettings
  ): Promise<AppearanceSettingsSnapshot> {
    const settings = AppearanceSettingsSchema.parse(rawInput);
    let saved: AppearanceSettingsSnapshot | undefined;
    const operation = this.writeChain.then(async () => {
      const disk: DiskAppearanceSettings = {
        version: 1,
        startupWindowSize: settings.startupWindowSize,
        mode: settings.mode,
        light: settings.light,
        dark: settings.dark,
        uiFontFamily: settings.uiFontFamily,
        editorFontFamily: settings.editorFontFamily
      };
      await writeJsonAtomic(this.settingsPath, disk);
      saved = AppearanceSettingsSnapshotSchema.parse({
        persisted: true,
        settings
      });
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }
}
