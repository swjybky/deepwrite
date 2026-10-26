import { beforeEach, describe, expect, it, vi } from "vitest";

const isReady = vi.fn(() => true);
const setProxy = vi.fn(async (): Promise<void> => undefined);
const closeAllConnections = vi.fn(async () => undefined);

vi.mock("electron", () => ({
  app: { isReady },
  session: {
    defaultSession: { setProxy, closeAllConnections }
  }
}));

let preference: typeof import("./network-proxy-preference");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  isReady.mockReturnValue(true);
  setProxy.mockResolvedValue(undefined);
  closeAllConnections.mockResolvedValue(undefined);
  preference = await import("./network-proxy-preference");
});

describe("applyNetworkProxyPreference", () => {
  it("uses Chromium system proxy when enabled and direct mode when disabled", async () => {
    preference.applyNetworkProxyPreference(true);
    await preference.waitForNetworkProxyPreference();
    expect(setProxy).toHaveBeenCalledWith({ mode: "system" });
    preference.applyNetworkProxyPreference(false);
    await preference.waitForNetworkProxyPreference();
    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it("does not touch Chromium session before the app is ready", () => {
    isReady.mockReturnValueOnce(false);
    preference.applyNetworkProxyPreference(false);
    expect(setProxy).not.toHaveBeenCalled();
  });

  it("waits for a pending setting before reporting the network ready", async () => {
    let release: (() => void) | undefined;
    setProxy.mockReturnValueOnce(
      new Promise<void>((resolve) => (release = resolve))
    );
    preference.applyNetworkProxyPreference(true);
    let ready = false;
    const pending = preference.waitForNetworkProxyPreference().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(closeAllConnections).not.toHaveBeenCalled();
    release!();
    await pending;
    expect(ready).toBe(true);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("applies rapid changes in order and closes old pooled connections", async () => {
    let release: (() => void) | undefined;
    setProxy.mockReturnValueOnce(
      new Promise<void>((resolve) => (release = resolve))
    );
    preference.applyNetworkProxyPreference(true);
    preference.applyNetworkProxyPreference(false);
    release!();
    await preference.waitForNetworkProxyPreference();
    expect(setProxy.mock.calls).toEqual([
      [{ mode: "system" }],
      [{ mode: "direct" }]
    ]);
    expect(closeAllConnections.mock.invocationCallOrder[0]).toBeLessThan(
      setProxy.mock.invocationCallOrder[1]!
    );
  });

  it("does not reset connections when unrelated settings save the same preference", async () => {
    preference.applyNetworkProxyPreference(false);
    await preference.waitForNetworkProxyPreference();
    preference.applyNetworkProxyPreference(false);
    await preference.waitForNetworkProxyPreference();
    expect(setProxy).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("surfaces a failed setting and permits a subsequent retry", async () => {
    setProxy.mockRejectedValueOnce(new Error("proxy update rejected"));
    preference.applyNetworkProxyPreference(true);
    await expect(preference.waitForNetworkProxyPreference()).rejects.toThrow(
      "proxy update rejected"
    );
    expect(closeAllConnections).not.toHaveBeenCalled();
    preference.applyNetworkProxyPreference(true);
    await preference.waitForNetworkProxyPreference();
    expect(setProxy).toHaveBeenCalledTimes(2);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });
});
