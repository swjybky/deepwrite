import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomHex8 } from "@deepwrite/shared";
import {
  normalizeDiskModelSettings,
  type DiskModelSettings
} from "./free-model-settings-state";

export interface DiskModelSecrets {
  version: 1;
  encryptedApiKeys: Record<string, string>;
}

export interface ModelConfigState {
  settings: DiskModelSettings;
  secrets: DiskModelSecrets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacySecrets(raw: unknown): DiskModelSecrets {
  const values =
    isRecord(raw) && isRecord(raw.encryptedApiKeys) ? raw.encryptedApiKeys : {};
  return {
    version: 1,
    encryptedApiKeys: Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0
      )
    )
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // Never include configuration contents or credentials in parse errors.
    if (error instanceof SyntaxError)
      throw new Error("模型配置文件损坏，无法读取。");
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const unsupported = new Set(["EPERM", "EISDIR", "ENOTSUP", "EINVAL"]);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error: unknown) {
    if (!unsupported.has((error as NodeJS.ErrnoException).code ?? ""))
      throw error;
  } finally {
    await handle?.close();
  }
}

/** Main-only storage. V3 commits metadata and encrypted credentials together. */
export class ModelConfigPersistence {
  private readonly path: string;
  private readonly legacySecretsPath: string;

  constructor(userDataPath: string) {
    this.path = join(userDataPath, "config", "models.json");
    this.legacySecretsPath = join(userDataPath, "config", "model-secrets.json");
  }

  async read(): Promise<ModelConfigState> {
    const raw = await readJson(this.path);
    if (isRecord(raw) && raw.version === 3) {
      if (
        !isRecord(raw.encryptedApiKeys) ||
        Object.values(raw.encryptedApiKeys).some(
          (value) => typeof value !== "string" || value.length === 0
        )
      )
        throw new Error("模型配置中的加密密钥数据损坏，无法读取。");
      return {
        settings: normalizeDiskModelSettings({ ...raw, version: 2 }),
        secrets: {
          version: 1,
          encryptedApiKeys: raw.encryptedApiKeys as Record<string, string>
        }
      };
    }
    if (
      raw !== undefined &&
      (!isRecord(raw) || ![1, 2].includes(raw.version as number))
    ) {
      throw new Error("模型配置版本不受支持，无法读取。");
    }
    return {
      settings: normalizeDiskModelSettings(raw),
      secrets: legacySecrets(await readJson(this.legacySecretsPath))
    };
  }

  async write({ settings, secrets }: ModelConfigState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.models-${randomHex8()}.tmp`);
    let createdTemporary = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      createdTemporary = true;
      try {
        await handle.writeFile(
          `${JSON.stringify(
            {
              ...settings,
              version: 3,
              encryptedApiKeys: secrets.encryptedApiKeys
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      // This is the only commit point. Readers see one complete generation.
      await rename(temporary, this.path);
      await syncDirectory(directory);
    } finally {
      if (createdTemporary) {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    // Cleanup is not part of the commit. A crash or cleanup failure is safe:
    // a V3 reader never falls back to this old, potentially stale secrets file.
    await rm(this.legacySecretsPath, { force: true }).catch(() => undefined);
  }
}
