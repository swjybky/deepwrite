import { withConfigurationLock } from "./configuration-lock";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  createDefaultGeneralSettings,
  type GeneralSettings,
  type GeneralSettingsSnapshot
} from "@deepwrite/contracts";
import { writeJsonAtomic, isNodeError } from "@deepwrite/shared/node";

interface DiskGeneralSettings extends Omit<
  GeneralSettings,
  | "permissionMode"
  | "taskNotification"
  | "externalControlEnabled"
  | "defaultTextViewMode"
  | "bodyTextFormats"
  | "showContextUsage"
  | "textAttachmentMaxCharacters"
  | "contextCompaction"
  | "useNetworkProxy"
  | "moreFeatures"
  | "versionHistoryEnabled"
> {
  version: 1 | 2;
  permissionMode: GeneralSettings["permissionMode"] | "full-access";
  taskNotification?: boolean;
  externalControlEnabled?: boolean;
  bodyTextFormats?: GeneralSettings["bodyTextFormats"];
  defaultTextViewMode?: GeneralSettings["defaultTextViewMode"];
  showContextUsage?: boolean;
  textAttachmentMaxCharacters?: number;
  contextCompaction?: GeneralSettings["contextCompaction"];
  useNetworkProxy?: boolean;
  moreFeatures?: GeneralSettings["moreFeatures"];
  versionHistoryEnabled?: boolean;
}

export class GeneralSettingsStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "general-settings.json");
  }

  async list(): Promise<GeneralSettingsSnapshot> {
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, () => this.readSettings())
    );
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
        autoSave: candidate.autoSave,
        language: candidate.language,
        showInMenuBar: candidate.showInMenuBar,
        taskNotification: candidate.taskNotification,
        externalControlEnabled: candidate.externalControlEnabled,
        showContextUsage: candidate.showContextUsage,
        textAttachmentMaxCharacters: candidate.textAttachmentMaxCharacters,
        contextCompaction: candidate.contextCompaction,
        useNetworkProxy: candidate.useNetworkProxy,
        workspacePaneLayout: candidate.workspacePaneLayout,
        defaultTextViewMode: candidate.defaultTextViewMode,
        bodyTextFormats: candidate.bodyTextFormats,
        moreFeatures: candidate.moreFeatures,
        versionHistoryEnabled: candidate.versionHistoryEnabled
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
        await writeJsonAtomic(this.settingsPath, { version: 2, ...settings });
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
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        const disk: DiskGeneralSettings = {
          version: 2,
          ...settings
        };
        await writeJsonAtomic(this.settingsPath, disk);
        saved = GeneralSettingsSnapshotSchema.parse({
          persisted: true,
          settings
        });
      })
    );
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }
}
