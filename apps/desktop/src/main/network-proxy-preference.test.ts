import { describe, expect, it, vi } from "vitest";

const isReady = vi.fn(() => true);
const setProxy = vi.fn(async () => undefined);

vi.mock("electron", () => ({
  app: { isReady },
  session: {
    defaultSession: { setProxy }
  }
}));

const { applyNetworkProxyPreference } =
  await import("./network-proxy-preference");

describe("applyNetworkProxyPreference", () => {
  it("uses Chromium system proxy when enabled and direct mode when disabled", () => {
    applyNetworkProxyPreference(true);
    expect(setProxy).toHaveBeenCalledWith({ mode: "system" });
    applyNetworkProxyPreference(false);
    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
  });

  it("does not touch Chromium session before the app is ready", () => {
    setProxy.mockClear();
    isReady.mockReturnValueOnce(false);
    applyNetworkProxyPreference(false);
    expect(setProxy).not.toHaveBeenCalled();
  });
});
