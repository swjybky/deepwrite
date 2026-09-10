import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  createDefaultGeneralSettings,
  type GeneralSettings,
  type GeneralSettingsSnapshot
} from "@deepwrite/contracts";

interface DiskGeneralSettings extends Omit<
  GeneralSettings,
  | "permissionMode"
  | "autoApproveCrossStageOperations"
  | "defaultTextViewMode"
  | "showContextUsage"
  | "useNetworkProxy"
> {
  version: 1 | 2;
  permissionMode: GeneralSettings["permissionMode"] | "full-access";
  autoApproveCrossStageOperations?: boolean;
  defaultTextViewMode?: GeneralSettings["defaultTextViewMode"];
  showContextUsage?: boolean;
  useNetworkProxy?: boolean;
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

export class GeneralSettingsStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "general-settings.json");
  }

  async list(): Promise<GeneralSettingsSnapshot> {
    const operation = this.writeChain.then(() => this.readSettings());
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async readSettings(): Promise<GeneralSettingsSnapshot> {
    try {
      const raw = JSON.parse(
        await readFile(this.settingsPath, "utf8")
      ) as unknown;
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("version" in raw) ||
        (raw.version !== 1 && raw.version !== 2)
      ) {
        return GeneralSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultGeneralSettings()
        });
      }
      const candidate = raw as DiskGeneralSettings;
      const permissionMode =
        candidate.permissionMode === "full-access"
          ? "auto-approve"
          : candidate.permissionMode;
      const parsed = GeneralSettingsSchema.safeParse({
        permissionMode,
        autoApproveCrossStageOperations:
          candidate.autoApproveCrossStageOperations,
        autoSave: candidate.autoSave,
        language: candidate.language,
        showInMenuBar: candidate.showInMenuBar,
        showContextUsage: candidate.showContextUsage,
        useNetworkProxy: candidate.useNetworkProxy,
        workspacePaneLayout: candidate.workspacePaneLayout,
        defaultTextViewMode: candidate.defaultTextViewMode
      });
      if (!parsed.success) {
        return GeneralSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultGeneralSettings()
        });
      }
      const settings = parsed.data;
      if (candidate.version === 1) {
        // Apply the new approval defaults once; later user choices stay intact.
        settings.permissionMode = "auto-approve";
        settings.autoApproveCrossStageOperations = true;
        await atomicWriteJson(this.settingsPath, { version: 2, ...settings });
      }
      return GeneralSettingsSnapshotSchema.parse({
        persisted: true,
        settings
      });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return GeneralSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultGeneralSettings()
        });
      }
      throw error;
    }
  }

  async save(rawInput: GeneralSettings): Promise<GeneralSettingsSnapshot> {
    const settings = GeneralSettingsSchema.parse(rawInput);
    let saved: GeneralSettingsSnapshot | undefined;
    const operation = this.writeChain.then(async () => {
      const disk: DiskGeneralSettings = {
        version: 2,
        ...settings
      };
      await atomicWriteJson(this.settingsPath, disk);
      saved = GeneralSettingsSnapshotSchema.parse({
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
