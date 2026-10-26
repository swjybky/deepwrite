import { afterEach, describe, expect, it } from "vitest";
import {
  formatError,
  formatModelProviderError,
  getErrorCode,
  getErrorDetail,
  getErrorPayload
} from "./errors";
import { setAppLanguage } from "./index";

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));

describe("structured application errors", () => {
  it("explains content restrictions while preserving raw provider diagnostics", () => {
    const raw = "Provider stopped with: PROHIBITED_CONTENT";
    const error = { code: "pi_agent.provider_error", message: raw };
    expect(formatError(error, "fallback")).toContain("内容限制");
    expect(formatError(error, "fallback")).toContain("会话历史和作品上下文");
    expect(formatError(error, "fallback")).toContain("反代服务");
    expect(formatError(error, "fallback")).toContain("PROHIBITED_CONTENT");
    expect(getErrorDetail(error)).toContain("内容限制");
    expect(getErrorPayload(error)?.message).toBe(raw);
    setAppLanguage("en-US", "zh-CN");
    expect(formatError(error, "fallback")).toContain("content restriction");
    expect(formatModelProviderError(raw)).toContain("PROHIBITED_CONTENT");
    expect(formatModelProviderError("503 Service Unavailable")).toBe(
      "503 Service Unavailable"
    );
    expect(
      formatError(new Error("Gateway failed", { cause: error }), "fallback")
    ).toContain("content restriction");
  });

  it("localizes the authoritative prompt budget without exposing diagnostic text", () => {
    const error = {
      code: "session.prompt_budget_exceeded",
      message: "fixture diagnostic",
      details: {
        inputTokens: 60_000,
        maxInputTokens: 57_600,
        budgetTokens: 64_000
      }
    };
    expect(formatError(error, "fallback")).toContain("预留 10% 余量");
    setAppLanguage("en-US", "zh-CN");
    expect(formatError(error, "fallback")).toContain("10% reserve");
    expect(formatError(error, "fallback")).toContain("64,000-token");
    expect(formatError(error, "fallback")).not.toContain(error.message);
    expect(
      formatError(
        { ...error, details: { ...error.details, inputTokens: Infinity } },
        "fallback"
      )
    ).toBe("fallback");
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
