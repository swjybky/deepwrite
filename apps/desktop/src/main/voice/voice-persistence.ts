import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withConfigurationLock } from "../configuration-lock";
import {
  createDefaultVoiceSettings,
  VoiceSettingsSchema,
  VoiceSettingsInputSchema,
  VoiceUsageRecordSchema,
  VoiceUsageSchema,
  type VoiceProfileId,
  type VoiceSettings,
  type VoiceSettingsInput,
  type VoiceUsageRecord
} from "@deepwrite/contracts";

export interface VoiceSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("语音配置或用量文件无法读取，请检查本地文件。");
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch {
    throw new Error("语音配置或用量保存失败，请检查本地存储空间。");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function recentUsage(records: VoiceUsageRecord[]): VoiceUsageRecord[] {
  return records
    .sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
    )
    .slice(-10);
}

export class VoicePersistence {
  private readonly settingsPath: string;
  private readonly usagePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly storage: VoiceSecureStorage,
    usageDataPath = userDataPath
  ) {
    this.settingsPath = join(userDataPath, "config", "voice.json");
    this.usagePath = join(usageDataPath, "config", "voice-usage.json");
  }

  private async readSettings() {
    const raw = await readJson(this.settingsPath);
    if (raw === undefined) {
      return {
        version: 1 as const,
        settings: createDefaultVoiceSettings(),
        encryptedApiKeys: {} as Record<string, string>
      };
    }
    if (
      !isRecord(raw) ||
      raw.version !== 1 ||
      !isRecord(raw.encryptedApiKeys) ||
      Object.values(raw.encryptedApiKeys).some(
        (value) => typeof value !== "string" || value.length === 0
      )
    ) {
      throw new Error("语音配置文件损坏，无法读取。");
    }
    const parsed = VoiceSettingsSchema.safeParse(raw.settings);
    if (!parsed.success) throw new Error("语音配置文件损坏，无法读取。");
    return {
      version: 1 as const,
      settings: parsed.data,
      encryptedApiKeys: raw.encryptedApiKeys as Record<string, string>
    };
  }

  private publicSettings(
    settings: VoiceSettings,
    encryptedApiKeys: Record<string, string>
  ): VoiceSettings {
    return {
      ...settings,
      profiles: settings.profiles.map((profile) => ({
        ...profile,
        hasApiKey: Boolean(encryptedApiKeys[profile.id])
      }))
    };
  }

  async getSettings(): Promise<VoiceSettings> {
    await this.writeChain;
    const { settings, encryptedApiKeys } = await this.readSettings();
    return this.publicSettings(settings, encryptedApiKeys);
  }

  async saveSettings(input: VoiceSettingsInput): Promise<VoiceSettings> {
    const parsed = VoiceSettingsInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("语音配置无效，请检查填写内容。");
    return this.serialize(async () => {
      const stored = await this.readSettings();
      const encryptedApiKeys = { ...stored.encryptedApiKeys };
      for (const profile of parsed.data.profiles) {
        if (profile.clearApiKey) {
          delete encryptedApiKeys[profile.id];
        } else if (profile.apiKey?.trim()) {
          if (!this.storage.isEncryptionAvailable()) {
            throw new Error("系统安全存储不可用，无法安全保存语音 API Key。");
          }
          try {
            encryptedApiKeys[profile.id] = this.storage
              .encryptString(profile.apiKey.trim())
              .toString("base64");
          } catch {
            throw new Error("语音 API Key 加密失败，配置未保存。");
          }
        }
      }
      const settings = VoiceSettingsSchema.parse({
        ...parsed.data,
        profiles: parsed.data.profiles.map((profile) => ({
          id: profile.id,
          baseUrl: profile.baseUrl,
          model: profile.model,
          hasApiKey: Boolean(encryptedApiKeys[profile.id])
        }))
      });
      await writeJson(this.settingsPath, {
        version: 1,
        settings,
        encryptedApiKeys
      });
      return settings;
    });
  }

  async resolve(profileId: VoiceProfileId) {
    await this.writeChain;
    const { settings, encryptedApiKeys } = await this.readSettings();
    const profile = settings.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw new Error("语音提供商不存在，请检查语音配置。");
    const encrypted = encryptedApiKeys[profileId];
    if (!encrypted) throw new Error("请先在语音配置中填写并保存 API Key。");
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法读取语音 API Key。");
    }
    let apiKey: string;
    try {
      apiKey = this.storage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new Error("语音 API Key 无法解密，请重新填写并保存。");
    }
    if (!apiKey) throw new Error("请先在语音配置中填写并保存 API Key。");
    return { ...profile, apiKey, language: settings.language };
  }

  private async readUsage(): Promise<VoiceUsageRecord[]> {
    const raw = await readJson(this.usagePath);
    if (raw === undefined) return [];
    const parsed = VoiceUsageSchema.safeParse(raw);
    if (!parsed.success) throw new Error("语音用量文件损坏，无法读取。");
    return parsed.data;
  }

  async getUsage(): Promise<VoiceUsageRecord[]> {
    return this.serialize(async () => {
      const records = await this.readUsage();
      const recent = recentUsage(records);
      if (records.length > recent.length)
        await writeJson(this.usagePath, recent);
      return recent;
    });
  }

  async appendUsage(record: VoiceUsageRecord): Promise<void> {
    await this.serialize(async () => {
      const records = await this.readUsage();
      if (records.some((entry) => entry.requestId === record.requestId)) return;
      records.push(VoiceUsageRecordSchema.parse(record));
      await writeJson(this.usagePath, recentUsage(records));
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, operation)
    );
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
