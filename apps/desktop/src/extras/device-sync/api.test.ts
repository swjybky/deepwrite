import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_SYNC_IPC_CHANNEL } from "@deepwrite/contracts";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: { invoke } }));
import { deviceSync } from "../../preload/device-sync-api";

describe("device sync preload boundary", () => {
  beforeEach(() => invoke.mockReset());

  it("validates requests and unwraps a validated response", async () => {
    invoke.mockResolvedValue({ ok: true, value: { kind: "cancelled" } });
    await expect(deviceSync.request({ operation: "cancel" })).resolves.toEqual({
      kind: "cancelled"
    });
    expect(invoke).toHaveBeenCalledWith(
      DEVICE_SYNC_IPC_CHANNEL,
      expect.objectContaining({
        type: "deviceSync.request",
        payload: { operation: "cancel" }
      })
    );
  });

  it("preserves a safe actionable error returned by main", async () => {
    invoke.mockResolvedValue({ ok: false, message: "请先连接网盘。" });
    await expect(deviceSync.request({ operation: "status" })).rejects.toThrow(
      "请先连接网盘。"
    );
  });

  it.each([
    "无法解析网盘服务器地址，请检查地址和 DNS 设置。",
    "网盘安全证书验证失败，请检查服务器证书和系统时间。",
    "无法通过代理连接网盘，请检查系统代理设置。",
    "网盘重定向地址不安全，请填写服务商提供的 HTTPS WebDAV 直连地址。",
    "网盘重定向次数过多，请检查服务器地址。"
  ])(
    "preserves connection diagnostics through preload: %s",
    async (message) => {
      invoke.mockResolvedValue({ ok: false, message });
      await expect(deviceSync.request({ operation: "status" })).rejects.toThrow(
        message
      );
    }
  );

  it("sanitizes rejected IPC errors and malformed remote values", async () => {
    invoke.mockRejectedValue(
      new Error(
        "https://invalid-user:invalid-password@example.test/dav?token=invalid-test-token"
      )
    );
    const error: unknown = await deviceSync
      .request({ operation: "status" })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(
      /example\.test|invalid-password|invalid-test-token/
    );
    invoke.mockResolvedValue({ ok: true, value: { kind: "unrecognized" } });
    await expect(deviceSync.request({ operation: "status" })).rejects.toThrow();
  });
});
