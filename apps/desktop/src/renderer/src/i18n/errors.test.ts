import { afterEach, describe, expect, it } from "vitest";
import { formatError, getErrorCode, getErrorPayload } from "./errors";
import { setAppLanguage } from "./index";

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));

describe("structured application errors", () => {
  it("shows localized credential and model storage failures from plain IPC objects", () => {
    for (const code of [
      "secure_storage.unavailable",
      "secure_storage.encrypt_failed",
      "secure_storage.decrypt_failed",
      "models.permission_denied",
      "models.disk_full"
    ]) {
      const error = { code, message: "private diagnostic" };
      const chinese = formatError(error, "fallback");
      expect(chinese).not.toBe("fallback");
      expect(chinese).not.toContain("private diagnostic");
      setAppLanguage("en-US", "zh-CN");
      expect(formatError(error, "fallback")).not.toBe(chinese);
      setAppLanguage("zh-CN", "zh-CN");
    }
  });
  it("shows actionable local storage causes without revealing raw diagnostic content", () => {
    const error = {
      code: "renderer_state.command_failed",
      message: "fixture private manuscript",
      details: {
        storageCode: "permission_denied",
        nativeCode: "EACCES",
        phase: "database-open"
      }
    };
    expect(formatError(error, "智能体请求受理失败。")).toContain(
      "用户数据目录无法写入"
    );
    expect(formatError(error, "fallback")).toContain(
      "permission_denied/EACCES"
    );
    expect(formatError(error, "fallback")).not.toContain(
      "fixture private manuscript"
    );
    setAppLanguage("en-US", "zh-CN");
    expect(formatError(error, "fallback")).toContain("not writable");
    expect(
      formatError(
        { ...error, details: { storageCode: "migration_duplicate_message" } },
        "fallback"
      )
    ).toContain("migration_duplicate_message");
  });

  it("localizes by stable code while preserving diagnostics and data", () => {
    const error = {
      code: "catalog.conflict",
      message: "original diagnostic",
      details: { expectedRevision: "before", actualRevision: "after" }
    };
    setAppLanguage("en-US", "zh-CN");
    expect(formatError(error, "Save failed")).toBe(
      "The local file changed elsewhere. Reload it and review your changes."
    );
    expect(getErrorCode(error)).toBe("catalog.conflict");
    expect(getErrorPayload(error)).toEqual(error);
    setAppLanguage("zh-CN", "en-US");
    expect(formatError(error, "保存失败")).toContain(
      "本地文件已在其他位置更新"
    );
  });

  it("uses the caller's translated fallback for unknown remote codes", () => {
    expect(
      formatError(
        { code: "unknown.failure", message: "diagnostic" },
        "Could not save"
      )
    ).toBe("Could not save");
    expect(formatError(new Error("local validation"), "Could not save")).toBe(
      "local validation"
    );
    expect(
      getErrorCode(new Error("catalog.conflict: arbitrary text"))
    ).toBeUndefined();
    expect(
      formatError(
        Object.assign(new Error("Pending review"), { code: "session_busy" }),
        "Could not delete"
      )
    ).toBe("Pending review");
    expect(getErrorCode({ code: "catalog.conflict" })).toBeUndefined();
  });
});
