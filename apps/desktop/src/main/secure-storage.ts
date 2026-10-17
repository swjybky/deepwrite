import { safeStorage } from "electron";
import type { SecureStorageErrorCode } from "@deepwrite/contracts";

export class SecureStorageError extends Error {
  constructor(readonly code: SecureStorageErrorCode) {
    super(
      {
        "secure_storage.unavailable":
          "系统安全存储当前不可用，请启动并解锁系统密钥服务。",
        "secure_storage.encrypt_failed": "凭据加密失败，请检查系统安全存储。",
        "secure_storage.decrypt_failed":
          "凭据解密失败，请确认使用原有系统密钥存储。"
      }[code]
    );
    this.name = "SecureStorageError";
  }
}

/** All production credential stores use the same OS-backed encryption policy. */
export const secureStorage = {
  isEncryptionAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return !(
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend?.() === "basic_text"
    );
  },
  encryptString(value: string): Buffer {
    if (!this.isEncryptionAvailable())
      throw new SecureStorageError("secure_storage.unavailable");
    try {
      return safeStorage.encryptString(value);
    } catch {
      throw new SecureStorageError("secure_storage.encrypt_failed");
    }
  },
  decryptString(value: Buffer): string {
    if (!this.isEncryptionAvailable())
      throw new SecureStorageError("secure_storage.unavailable");
    try {
      return safeStorage.decryptString(value);
    } catch {
      throw new SecureStorageError("secure_storage.decrypt_failed");
    }
  }
};
