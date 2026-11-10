import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StorageLocationStore } from "./storage-location-store";

/** Follow the installed app's relocation pointer without migrating its data. */
export function resolveConfigurationProfile(
  sharedDefaultPath: string | undefined,
  runtimePath: string
): string {
  if (!sharedDefaultPath) return runtimePath;
  const locations = new StorageLocationStore(sharedDefaultPath);
  if (locations.pending)
    throw new Error("请先启动正式版完成用户数据迁移，再启动开发版。");
  locations.assertAvailable();
  return locations.currentPath;
}

/** Windows safeStorage uses the encrypted OSCrypt key in Chromium's Local State.
 * Reuse that key while retaining the development session's other preferences.
 * Never copy the installed app's cookies, cache or browser storage.
 */
export function prepareConfigurationEncryption(
  configurationPath: string,
  runtimePath: string,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== "win32" || configurationPath === runtimePath) return;
  const read = (root: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(root, "Local State"), "utf8")
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid local state");
      return value as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("无法读取系统加密配置，请保留现有用户数据后重试。");
    }
  };
  const shared = read(configurationPath);
  const crypt = shared.os_crypt as { encrypted_key?: unknown } | undefined;
  if (typeof crypt?.encrypted_key !== "string" || !crypt.encrypted_key)
    throw new Error("请先启动一次正式版建立系统加密存储，再启动开发版。");
  const runtime = read(runtimePath);
  const current = runtime.os_crypt as { encrypted_key?: unknown } | undefined;
  if (current?.encrypted_key === crypt.encrypted_key) return;
  // An existing runtime key may still protect private sync state. Preserve it
  // rather than silently making those credentials unreadable.
  if (current?.encrypted_key)
    throw new Error(
      "开发目录使用了另一套加密存储，请先备份并移走原开发目录后重试。"
    );
  mkdirSync(runtimePath, { recursive: true, mode: 0o700 });
  const temporary = join(runtimePath, `.local-state-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ ...runtime, os_crypt: crypt }), {
      mode: 0o600
    });
    renameSync(temporary, join(runtimePath, "Local State"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
