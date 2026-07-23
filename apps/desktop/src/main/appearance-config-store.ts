import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AppearanceSettingsSchema,
  AppearanceSettingsSnapshotSchema,
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";

interface DiskAppearanceSettings {
  version: 1;
  mode: AppearanceSettings["mode"];
  light: AppearanceSettings["light"];
  dark: AppearanceSettings["dark"];
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
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
      const raw = JSON.parse(await readFile(this.settingsPath, "utf8")) as unknown;
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
          mode: candidate.mode,
          light: candidate.light,
          dark: candidate.dark
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

  async save(rawInput: AppearanceSettings): Promise<AppearanceSettingsSnapshot> {
    const settings = AppearanceSettingsSchema.parse(rawInput);
    let saved: AppearanceSettingsSnapshot | undefined;
    const operation = this.writeChain.then(async () => {
      const disk: DiskAppearanceSettings = {
        version: 1,
        mode: settings.mode,
        light: settings.light,
        dark: settings.dark
      };
      await atomicWriteJson(this.settingsPath, disk);
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
