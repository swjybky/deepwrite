import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppAlertStore } from "./app-alert-store";
import { DeepWriteFreeModelCatalogStore } from "./deepwrite-free-model-config";

const { chromiumFetch, waitForProxy, nodeFetch } = vi.hoisted(() => ({
  chromiumFetch: vi.fn(),
  waitForProxy: vi.fn(async (): Promise<void> => undefined),
  nodeFetch: vi.fn()
}));
vi.mock("electron", () => ({ net: { fetch: chromiumFetch } }));
vi.mock("./network-proxy-preference", () => ({
  waitForNetworkProxyPreference: waitForProxy
}));
vi.mock("./deepwrite-public-data-config", () => ({
  deepWritePublicDataUrl: (name: string) =>
    `https://gateway.example.test/deepwrite/v1/${name}`,
  deepWritePublicDataHeaders: (additional: HeadersInit) => {
    const headers = new Headers(additional);
    headers.set("Authorization", "Bearer invalid-test-public-key");
    return headers;
  }
}));
const roots: string[] = [];
async function profile() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-public-network-"));
  roots.push(root);
  return root;
}
beforeEach(() => {
  vi.clearAllMocks();
  waitForProxy.mockResolvedValue(undefined);
  nodeFetch.mockRejectedValue(new Error("Node transport must not be used"));
  vi.stubGlobal("fetch", nodeFetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("public configuration through the selected network session", () => {
  it("refreshes old announcements after reopening without using Node networking", async () => {
    const root = await profile();
    chromiumFetch.mockResolvedValueOnce(
      Response.json({ desketop: ["旧公告"], model: [] })
    );
    expect(
      (await new AppAlertStore(root).getSnapshot()).desktopMessages
    ).toEqual(["旧公告"]);
    chromiumFetch.mockResolvedValueOnce(
      Response.json({ desketop: ["新公告"], model: [] })
    );
    expect(
      (await new AppAlertStore(root).getSnapshot()).desktopMessages
    ).toEqual(["新公告"]);
    expect(chromiumFetch).toHaveBeenCalledTimes(2);
    expect(waitForProxy).toHaveBeenCalledTimes(2);
    expect(nodeFetch).not.toHaveBeenCalled();
  });

  it("waits for the proxy before loading the free model manifest with its public-service header", async () => {
    let release: (() => void) | undefined;
    waitForProxy.mockReturnValueOnce(
      new Promise<void>((resolve) => (release = resolve))
    );
    chromiumFetch.mockResolvedValueOnce(
      Response.json({
        schemaVersion: 1,
        revision: "invalid-test-revision",
        status: { enabled: true },
        models: []
      })
    );
    const store = new DeepWriteFreeModelCatalogStore(await profile(), {
      appVersion: "1.7.1"
    });
    const loading = store.getCatalog();
    await vi.waitFor(() => expect(waitForProxy).toHaveBeenCalledOnce());
    expect(chromiumFetch).not.toHaveBeenCalled();
    release!();
    expect(await loading).toMatchObject({
      manifestAvailable: true,
      revision: "invalid-test-revision"
    });
    const [url, init] = chromiumFetch.mock.calls[0]!;
    expect(new URL(url).pathname).toBe("/deepwrite/v1/MODEL.json");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer invalid-test-public-key"
    );
    expect(nodeFetch).not.toHaveBeenCalled();
  });
});
