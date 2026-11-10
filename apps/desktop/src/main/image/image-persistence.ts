import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { withConfigurationLock } from "../configuration-lock";
import {
  ImageModelSettingsInputSchema,
  ImageModelSettingsSchema,
  ImageUsageRecordSchema,
  ImageUsageSchema,
  type ImageModelSettings,
  type ImageModelSettingsInput,
  type ImageUsageRecord
} from "@deepwrite/contracts";
import type { VoiceSecureStorage } from "../voice/voice-persistence";
import { readImageJson, writeImageJson } from "./image-json";

interface StoredSettings {
  version: 1;
  settings: ImageModelSettings;
  encryptedApiKeys: Record<string, string>;
}

function encryptedKey(
  keys: Record<string, string>,
  id: string
): string | undefined {
  return Object.hasOwn(keys, id) && typeof keys[id] === "string"
    ? keys[id]
    : undefined;
}

export class ImagePersistence {
  private readonly settingsPath: string;
  private readonly usagePath: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly storage: VoiceSecureStorage,
    usageDataPath = userDataPath
  ) {
    this.settingsPath = join(userDataPath, "config", "image-models.json");
    this.usagePath = join(usageDataPath, "config", "image-usage.json");
  }

  private async readSettings(): Promise<StoredSettings> {
    const raw = await readImageJson(this.settingsPath);
    if (raw === undefined)
      return {
        version: 1,
        settings: { activeProfileId: null, profiles: [] },
        encryptedApiKeys: {}
      };
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("version" in raw) ||
      raw.version !== 1 ||
      !("settings" in raw) ||
      !("encryptedApiKeys" in raw)
    )
      throw new Error("图片配置文件损坏，无法读取。");
    const settings = ImageModelSettingsSchema.safeParse(raw.settings);
    const keys = raw.encryptedApiKeys;
    if (
      !settings.success ||
      typeof keys !== "object" ||
      keys === null ||
      Array.isArray(keys) ||
      Object.values(keys).some((key) => typeof key !== "string" || !key)
    )
      throw new Error("图片配置文件损坏，无法读取。");
    return {
      version: 1,
      settings: settings.data,
      encryptedApiKeys: keys as Record<string, string>
    };
  }

  private publicSettings(stored: StoredSettings): ImageModelSettings {
    const profiles = stored.settings.profiles.map((profile) => ({
      ...profile,
      hasApiKey: Boolean(encryptedKey(stored.encryptedApiKeys, profile.id))
    }));
    const active = profiles.find(
      (profile) =>
        profile.id === stored.settings.activeProfileId && profile.hasApiKey
    );
    return {
      profiles,
      activeProfileId:
        active?.id ?? profiles.find((profile) => profile.hasApiKey)?.id ?? null
    };
  }

  async getSettings(): Promise<ImageModelSettings> {
    await this.chain;
    return this.publicSettings(await this.readSettings());
  }

  async saveSettings(
    input: ImageModelSettingsInput
  ): Promise<ImageModelSettings> {
    const parsed = ImageModelSettingsInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("图片配置无效，请检查填写内容。");
    return this.serialize(async () => {
      const stored = await this.readSettings();
      const encryptedApiKeys: Record<string, string> = Object.create(
        null
      ) as Record<string, string>;
      const profiles = parsed.data.profiles.map((profile) => ({
        ...profile,
        id: profile.id ?? `img_${randomUUID().replaceAll("-", "")}`
      }));
      if (
        new Set(profiles.map((profile) => profile.id)).size !== profiles.length
      )
        throw new Error("图片配置 ID 重复。");
      for (const profile of profiles) {
        if (profile.clearApiKey) continue;
        if (profile.apiKey?.trim()) {
          if (!this.storage.isEncryptionAvailable())
            throw new Error("系统安全存储不可用，无法安全保存图片 API Key。");
          try {
            encryptedApiKeys[profile.id] = this.storage
              .encryptString(profile.apiKey.trim())
              .toString("base64");
          } catch {
            throw new Error("图片 API Key 加密失败，配置未保存。");
          }
        } else if (encryptedKey(stored.encryptedApiKeys, profile.id)) {
          encryptedApiKeys[profile.id] = encryptedKey(
            stored.encryptedApiKeys,
            profile.id
          )!;
        }
      }
      const settings = ImageModelSettingsSchema.parse({
        activeProfileId: parsed.data.activeProfileId,
        profiles: profiles.map(
          ({ apiKey: _key, clearApiKey: _clear, ...profile }) => ({
            ...profile,
            hasApiKey: Boolean(encryptedApiKeys[profile.id])
          })
        )
      });
      const publicSettings = this.publicSettings({
        version: 1,
        settings,
        encryptedApiKeys
      });
      await writeImageJson(this.settingsPath, {
        version: 1,
        settings: publicSettings,
        encryptedApiKeys
      });
      return publicSettings;
    });
  }

  async resolve(profileId?: string) {
    await this.chain;
    const stored = await this.readSettings();
    const settings = this.publicSettings(stored);
    const profile = settings.profiles.find(
      (entry) => entry.id === (profileId ?? settings.activeProfileId)
    );
    if (!profile?.hasApiKey) throw new Error("请先配置并选择图片模型。");
    if (!this.storage.isEncryptionAvailable())
      throw new Error("系统安全存储不可用，无法读取图片 API Key。");
    let apiKey: string;
    try {
      apiKey = this.storage.decryptString(
        Buffer.from(stored.encryptedApiKeys[profile.id]!, "base64")
      );
    } catch {
      throw new Error("图片 API Key 无法解密，请重新填写并保存。");
    }
    if (!apiKey) throw new Error("请重新填写并保存图片 API Key。");
    return { ...profile, apiKey };
  }

  async getUsage(): Promise<ImageUsageRecord[]> {
    await this.chain;
    return this.readUsage();
  }

  private async readUsage(): Promise<ImageUsageRecord[]> {
    const raw = await readImageJson(this.usagePath);
    if (raw === undefined) return [];
    const result = ImageUsageSchema.safeParse(raw);
    if (!result.success) throw new Error("图片用量文件损坏，无法读取。");
    return result.data;
  }

  async appendUsage(record: ImageUsageRecord): Promise<void> {
    await this.serialize(async () => {
      const records = await this.readUsage();
      records.push(ImageUsageRecordSchema.parse(record));
      await writeImageJson(this.usagePath, records.slice(-100));
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() =>
      withConfigurationLock(this.settingsPath, operation)
    );
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
