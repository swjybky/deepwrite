import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeSyncJson } from "./atomic-json";
import { safeStorage } from "electron";
import {
  DeviceSyncSecretSchema,
  syncMetadataSchema,
  type SyncCredentialStore,
  type SyncMetadata,
  type SyncMetadataStore
} from "@deepwrite/contracts";

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
export class DesktopSyncMetadataStore implements SyncMetadataStore {
  private readonly path: string;
  constructor(root: string) {
    this.path = join(root, "device-sync.json");
  }
  async read(): Promise<SyncMetadata | null> {
    const value = await readOptional(this.path);
    return value === null ? null : syncMetadataSchema.parse(JSON.parse(value));
  }
  async write(value: SyncMetadata): Promise<void> {
    await writeSyncJson(
      this.path,
      JSON.stringify(syncMetadataSchema.parse(value))
    );
  }
}
export class DesktopSyncCredentialStore implements SyncCredentialStore {
  private readonly path: string;
  constructor(root: string) {
    this.path = join(root, "device-sync-secret.json");
  }
  private check(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error("系统安全存储不可用。");
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
    await writeSyncJson(
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
