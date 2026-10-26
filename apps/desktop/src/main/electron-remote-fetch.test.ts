import { beforeEach, describe, expect, it, vi } from "vitest";

const fetch = vi.fn(async () => new Response("ok"));
const waitForProxy = vi.fn(async (): Promise<void> => undefined);

vi.mock("electron", () => ({
  net: { fetch }
}));
vi.mock("./network-proxy-preference", () => ({
  waitForNetworkProxyPreference: waitForProxy
}));

const { electronRemoteFetch } = await import("./electron-remote-fetch");

beforeEach(() => {
  vi.clearAllMocks();
  waitForProxy.mockResolvedValue(undefined);
});

describe("electronRemoteFetch", () => {
  it("uses Chromium networking instead of Node fetch", async () => {
    const init = { method: "GET", cache: "no-store" as const };
    await electronRemoteFetch("https://gateway.example.test/v1/models", init);
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway.example.test/v1/models",
      init
    );
  });

  it("does not send a request through the previous proxy while a change is pending", async () => {
    let release: (() => void) | undefined;
    waitForProxy.mockReturnValueOnce(
      new Promise<void>((resolve) => (release = resolve))
    );
    const request = electronRemoteFetch(
      "https://gateway.example.test/v1/models"
    );
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    release!();
    await request;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not silently connect directly when applying the requested proxy fails", async () => {
    waitForProxy.mockRejectedValueOnce(new Error("proxy update rejected"));
    await expect(
      electronRemoteFetch("https://gateway.example.test/v1/models")
    ).rejects.toThrow("proxy update rejected");
    expect(fetch).not.toHaveBeenCalled();
  });
});
