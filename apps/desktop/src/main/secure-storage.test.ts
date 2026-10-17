import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().slice(10))
}));
vi.mock("electron", () => ({ safeStorage: storage }));
import { secureStorage, SecureStorageError } from "./secure-storage";
import { modelConfigErrorCode } from "./model-config-error";

beforeEach(() => vi.clearAllMocks());
describe("shared credential storage", () => {
  it("reads existing Electron ciphertext and writes through the same backend", () => {
    const fixture = "invalid-key-for-test-only";
    expect(
      secureStorage.decryptString(secureStorage.encryptString(fixture))
    ).toBe(fixture);
  });
  it("rejects unavailable storage before touching credentials", () => {
    storage.isEncryptionAvailable.mockReturnValueOnce(false);
    expect(() => secureStorage.encryptString("invalid-test-key")).toThrow(
      SecureStorageError
    );
    expect(storage.encryptString).not.toHaveBeenCalled();
  });
  it.runIf(process.platform === "linux")(
    "rejects basic_text even if Electron reports encryption available",
    () => {
      storage.getSelectedStorageBackend.mockReturnValueOnce("basic_text");
      expect(() => secureStorage.encryptString("invalid-test-key")).toThrow(
        "安全存储"
      );
      expect(storage.encryptString).not.toHaveBeenCalled();
    }
  );
  it("sanitizes crypto failures and preserves typed codes", () => {
    storage.encryptString.mockImplementationOnce(() => {
      throw new Error("private diagnostic");
    });
    try {
      secureStorage.encryptString("invalid-test-key");
      expect.fail("expected failure");
    } catch (error) {
      expect(modelConfigErrorCode(error, "models.save_failed")).toBe(
        "secure_storage.encrypt_failed"
      );
      expect(String(error)).not.toContain("private diagnostic");
    }
    storage.decryptString.mockImplementationOnce(() => {
      throw new Error("private diagnostic");
    });
    expect(() =>
      secureStorage.decryptString(Buffer.from("invalid-ciphertext"))
    ).toThrow(SecureStorageError);
  });
  it.each([
    ["EACCES", "models.permission_denied"],
    ["EPERM", "models.permission_denied"],
    ["ENOSPC", "models.disk_full"],
    ["EDQUOT", "models.disk_full"],
    ["EIO", "models.save_failed"]
  ])("maps %s without exposing paths", (code, expected) => {
    expect(
      modelConfigErrorCode(
        Object.assign(new Error("private path"), { code }),
        "models.save_failed"
      )
    ).toBe(expected);
  });
});
