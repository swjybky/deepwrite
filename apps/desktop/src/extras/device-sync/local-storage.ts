import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";
import { deepFreeze } from "@deepwrite/shared";
import {
  DeviceSyncSecretSchema,
  openSyncMetadata,
  sealSyncMetadata,
  syncMetadataSchema,
  type SyncSecretSealer,
  type SyncCredentialStore,
  type SyncMetadata,
  type SyncMetadataStore
} from "@deepwrite/contracts";
import { writeTextFileDurable } from "@deepwrite/shared/node";

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
function requireSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error("系统安全存储不可用。");
}

/** API keys inside sync state are encrypted with the OS secure storage at rest. */
const secretSealer: SyncSecretSealer = {
  async seal(content) {
    requireSecureStorage();
    return safeStorage.encryptString(content).toString("base64");
  },
  async open(sealed) {
    try {
      requireSecureStorage();
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      return null;
    }
  }
};

/**
 * Main is the only writer of the sync state, so after the first read every read is served from memory:
 * the file can hold a full copy of every work, and parsing it per status read stalls the main process.
 * Cached values are frozen because every reader shares them.
 */
export class DesktopSyncMetadataStore implements SyncMetadataStore {
  private readonly path: string;
  private cached: SyncMetadata | null = null;
  private writing: Promise<void> = Promise.resolve();
  constructor(root: string) {
    this.path = join(root, "device-sync.json");
  }
  async read(): Promise<SyncMetadata | null> {
    if (this.cached) return this.cached;
    const value = await readOptional(this.path);
    if (value === null) return null;
    const metadata = deepFreeze(
      await openSyncMetadata(
        syncMetadataSchema.parse(JSON.parse(value)),
        secretSealer
      )
    );
    // A write that finished during this read is newer than the file it read.
    this.cached ??= metadata;
    return metadata;
  }
  /** A copy with every API key sealed, for writers that put sync state in files themselves. */
  seal(value: SyncMetadata): Promise<SyncMetadata> {
    return sealSyncMetadata(syncMetadataSchema.parse(value), secretSealer);
  }
  async write(value: SyncMetadata): Promise<void> {
    // Parsing copies the value, so later changes to the caller's objects cannot reach the cache.
    const parsed = syncMetadataSchema.parse(value);
    const next = this.writing.then(async () => {
      try {
        const sealed = await sealSyncMetadata(parsed, secretSealer);
        await writeTextFileDurable(this.path, JSON.stringify(sealed));
        // A recovered intent arrives sealed; readers always get usable keys.
        this.cached = deepFreeze(await openSyncMetadata(parsed, secretSealer));
      } catch (error) {
        this.cached = null;
        throw error;
      }
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}
export class DesktopSyncCredentialStore implements SyncCredentialStore {
  private readonly path: string;
  constructor(root: string) {
    this.path = join(root, "device-sync-secret.json");
  }
  private check(): void {
    requireSecureStorage();
  }
  async get(): Promise<string | null> {
    const value = await readOptional(this.path);
    if (value === null) return null;
    this.check();
    return safeStorage.decryptString(
      Buffer.from(
        DeviceSyncSecretSchema.parse(JSON.parse(value)).encrypted,
        "base64"
      )
    );
  }
  async set(value: string): Promise<void> {
    this.check();
    await writeTextFileDurable(
      this.path,
      JSON.stringify({
        schemaVersion: 1,
        encrypted: safeStorage.encryptString(value).toString("base64")
      })
    );
  }
  async delete(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
