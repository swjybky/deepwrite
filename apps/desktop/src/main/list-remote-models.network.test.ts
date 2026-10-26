import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDeepWriteSiteOfficialCatalog } from "./deepwrite-site-official-catalog";
import { listRemoteModels } from "./list-remote-models";

const { chromiumFetch, waitForProxy, nodeFetch } = vi.hoisted(() => ({
  chromiumFetch: vi.fn(),
  waitForProxy: vi.fn(async () => undefined),
  nodeFetch: vi.fn()
}));
vi.mock("electron", () => ({ net: { fetch: chromiumFetch } }));
vi.mock("./network-proxy-preference", () => ({
  waitForNetworkProxyPreference: waitForProxy
}));
vi.mock("./deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test"
}));

beforeEach(() => {
  vi.clearAllMocks();
  waitForProxy.mockResolvedValue(undefined);
  nodeFetch.mockRejectedValue(new Error("Node transport must not be used"));
  vi.stubGlobal("fetch", nodeFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("model requests over the configured Chromium session", () => {
  it("loads the public catalog through Chromium without a user key or Node networking", async () => {
    chromiumFetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "writer", api: "openai-responses" }] })
    );
    const catalog = await loadDeepWriteSiteOfficialCatalog({
      listRemoteModels
    });
    expect(catalog.models).toEqual([{ id: "writer", api: "openai-responses" }]);
    expect(chromiumFetch).toHaveBeenCalledOnce();
    const [url, init] = chromiumFetch.mock.calls[0]!;
    expect(url).toBe("https://gateway.example.test/api/v1/public/models");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(waitForProxy).toHaveBeenCalledOnce();
    expect(nodeFetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      new Error("net::ERR_NAME_NOT_RESOLVED"),
      "dns",
      "无法解析模型服务地址",
      "ERR_NAME_NOT_RESOLVED"
    ],
    [
      new Error("net::ERR_CERT_AUTHORITY_INVALID"),
      "certificate",
      "证书校验失败",
      "ERR_CERT_AUTHORITY_INVALID"
    ],
    [
      new Error("net::ERR_PROXY_CONNECTION_FAILED"),
      "proxy",
      "网络代理",
      "ERR_PROXY_CONNECTION_FAILED"
    ],
    [
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      "refused",
      "拒绝了连接",
      "ECONNREFUSED"
    ],
    [
      new Error("net::ERR_CONNECTION_RESET"),
      "interrupted",
      "意外中断",
      "ERR_CONNECTION_RESET"
    ],
    [
      new Error("net::ERR_CONNECTION_TIMED_OUT"),
      "timeout",
      "拉取模型超时",
      "ERR_CONNECTION_TIMED_OUT"
    ]
  ])(
    "reports a safe reason for a native transport failure",
    async (cause, kind, message, code) => {
      chromiumFetch.mockRejectedValueOnce(cause);
      await expect(
        listRemoteModels({
          api: "openai-completions",
          baseUrl: "https://gateway.example.test/v1",
          apiKey: "invalid-test-key",
          provider: "custom"
        })
      ).rejects.toMatchObject({
        code: `models.list_remote_${kind}`,
        message: expect.stringContaining(`${code}`)
      });
      chromiumFetch.mockRejectedValueOnce(cause);
      await expect(
        loadDeepWriteSiteOfficialCatalog({ listRemoteModels })
      ).rejects.toThrow(`${message}`);
    }
  );
});
