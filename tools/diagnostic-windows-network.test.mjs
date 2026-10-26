import { describe, expect, it, vi } from "vitest";
import { probeWindowsNetwork } from "./diagnostic-windows-network.mjs";

describe("Windows system-network diagnostic", () => {
  it("uses a private child environment and returns only allowlisted fields", async () => {
    const url = "https://gateway.example.test/api/v1/public/models";
    const execute = vi.fn(async (_program, args, options) => {
      expect(args.join(" ")).not.toContain("gateway.example.test");
      expect(args.join(" ")).not.toContain("ExecutionPolicy");
      expect(options.env.DEEPWRITE_DIAGNOSTIC_TARGET).toBe(url);
      return {
        stdout: JSON.stringify({
          httpStatus: 200,
          manualProxyEnabled: true,
          proxyPacConfigured: false,
          rawUrl: url,
          secret: "invalid-test-secret"
        })
      };
    });
    expect(
      await probeWindowsNetwork(url, { platform: "win32", execute })
    ).toEqual({
      transport: "windows-dotnet-system",
      httpStatus: 200,
      manualProxyEnabled: true,
      proxyPacConfigured: false
    });
  });

  it("keeps certificate and DNS failures without their original messages", async () => {
    for (const code of [
      "TrustFailure",
      "NameResolutionFailure",
      "ProxyNameResolutionFailure"
    ]) {
      const execute = async () => ({
        stdout: JSON.stringify({ code, message: "invalid-test-secret" })
      });
      expect(
        await probeWindowsNetwork("https://gateway.example.test", {
          platform: "win32",
          execute
        })
      ).toEqual({ transport: "windows-dotnet-system", code });
    }
  });

  it("does not expose PowerShell errors or run a platform probe on other systems", async () => {
    const execute = vi.fn(async () => {
      throw new Error("invalid-test-secret");
    });
    expect(
      await probeWindowsNetwork("https://gateway.example.test", {
        platform: "darwin",
        execute
      })
    ).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(
      await probeWindowsNetwork("https://gateway.example.test", {
        platform: "win32",
        execute
      })
    ).toEqual({
      transport: "windows-dotnet-system",
      code: "PROBE_UNAVAILABLE"
    });
  });
});
