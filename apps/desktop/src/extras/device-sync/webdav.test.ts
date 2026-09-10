import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncErrorMessage, type SyncConfig } from "@deepwrite/contracts";
import { WebDavSyncTransport } from "./webdav";
import { MAX_DAV_TEXT, type DavFetch } from "./webdav-http";

const config: SyncConfig = {
  schemaVersion: 1,
  provider: "webdav",
  endpoint: "https://example.test/webdav",
  username: "invalid-test-user",
  directory: "DeepWriteSync",
  deviceName: "Test",
  spaceId: null,
  excludedKeys: []
};
const root = `${config.endpoint}/${config.directory}/`;
const password = "invalid-test-password";
const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

async function flush<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

describe("WebDAV transport compatibility", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("verifies create, list, upload, redirected download and delete end to end", async () => {
    let saved = "";
    const download =
      "https://download.example.test/object?signature=invalid-test-signature";
    const request = vi.fn<DavFetch>(async (url, init) => {
      if (url === download) return new Response(saved);
      switch (init.method) {
        case "MKCOL":
          return new Response(null, { status: 201 });
        case "PROPFIND":
          return new Response(
            '<d:multistatus xmlns:d="DAV:"></d:multistatus>',
            { status: 207 }
          );
        case "PUT":
          saved = String(init.body);
          return new Response(null, { status: 201 });
        case "GET":
          return redirect(download);
        case "DELETE":
          return new Response(null, { status: 204 });
        default:
          throw new Error("Unexpected method");
      }
    });
    await expect(
      flush(new WebDavSyncTransport(config, password, request).test())
    ).resolves.toBeUndefined();
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual([
      "MKCOL",
      "PROPFIND",
      "PUT",
      "GET",
      "GET",
      "DELETE"
    ]);
    const downloadInit = request.mock.calls.find(
      ([url]) => url === download
    )?.[1];
    expect(new Headers(downloadInit?.headers).has("authorization")).toBe(false);
    expect(downloadInit).toMatchObject({
      redirect: "manual",
      credentials: "omit"
    });
    expect(
      new Headers(request.mock.calls[0]?.[1].headers).get("authorization")
    ).toMatch(/^Basic /);
  });

  it.each(["MKCOL", "PROPFIND", "PUT", "DELETE"])(
    "preserves %s and its body across a trailing slash redirect",
    async (method) => {
      const source =
        method === "PROPFIND" || method === "MKCOL" ? root : `${root}item.json`;
      const target = source.endsWith("/") ? source.slice(0, -1) : `${source}/`;
      const request = vi
        .fn<DavFetch>()
        .mockResolvedValueOnce(redirect(target, 307))
        .mockResolvedValueOnce(
          method === "PROPFIND"
            ? new Response('<d:multistatus xmlns:d="DAV:"></d:multistatus>', {
                status: 207
              })
            : new Response(null, { status: 204 })
        );
      const transport = new WebDavSyncTransport(config, password, request);
      const operation =
        method === "MKCOL"
          ? transport.mkdir("")
          : method === "PROPFIND"
            ? transport.list("")
            : method === "PUT"
              ? transport.put("item.json", "内容")
              : transport.remove("item.json");
      await flush<unknown>(operation);
      expect(request.mock.calls[1]?.[0]).toBe(target);
      expect(request.mock.calls[1]?.[1]).toMatchObject({
        method,
        headers: request.mock.calls[0]?.[1].headers
      });
      expect(request.mock.calls[1]?.[1].body).toBe(
        request.mock.calls[0]?.[1].body
      );
    }
  );

  it.each([
    "http://download.example.test/object",
    "https://invalid-user:invalid-password@download.example.test/object",
    "https://download.example.test/object#fragment"
  ])(
    "rejects unsafe download targets without issuing another request: %s",
    async (location) => {
      const request = vi
        .fn<DavFetch>()
        .mockResolvedValueOnce(redirect(location));
      await expect(
        flush(
          new WebDavSyncTransport(config, password, request).get("item.json")
        )
      ).rejects.toThrow("网盘重定向地址不安全");
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["https://other.example.test/webdav/DeepWriteSync/item.json", 307],
    [`${root}different.json`, 307],
    [`${root}item.json?token=invalid-test-token`, 307],
    [`${root}item.json/`, 303]
  ])(
    "does not redirect writes to a different resource or convert them to GET",
    async (location, status) => {
      const request = vi
        .fn<DavFetch>()
        .mockResolvedValueOnce(redirect(String(location), Number(status)));
      await expect(
        flush(
          new WebDavSyncTransport(config, password, request).put(
            "item.json",
            "content"
          )
        )
      ).rejects.toThrow("网盘重定向地址不安全");
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it("never restores credentials after a download leaves the original resource", async () => {
    const request = vi
      .fn<DavFetch>()
      .mockResolvedValueOnce(redirect("https://download.example.test/object"))
      .mockResolvedValueOnce(redirect(`${root}item.json/`))
      .mockResolvedValueOnce(new Response("content"));
    await expect(
      flush(new WebDavSyncTransport(config, password, request).get("item.json"))
    ).resolves.toBe("content");
    for (const [, init] of request.mock.calls.slice(1))
      expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("limits redirect loops and long redirect chains", async () => {
    const loop = vi
      .fn<DavFetch>()
      .mockResolvedValueOnce(redirect(`${root}item.json`));
    await expect(
      flush(new WebDavSyncTransport(config, password, loop).get("item.json"))
    ).rejects.toThrow("网盘重定向次数过多");
    expect(loop).toHaveBeenCalledTimes(1);
    let hops = 0;
    const chain = vi.fn<DavFetch>(async () =>
      redirect(`https://download.example.test/${++hops}`)
    );
    await expect(
      flush(new WebDavSyncTransport(config, password, chain).get("item.json"))
    ).rejects.toThrow("网盘重定向次数过多");
    expect(chain).toHaveBeenCalledTimes(6);
  });

  it("preserves the original verification error if cleanup also fails", async () => {
    const request = vi
      .fn<DavFetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response('<multistatus xmlns="DAV:"></multistatus>', {
          status: 207
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"));
    await expect(
      flush(new WebDavSyncTransport(config, password, request).test())
    ).rejects.toThrow("没有访问该同步目录的权限。");
    expect(request.mock.calls.at(-1)?.[1].method).toBe("DELETE");
  });

  it("preserves size limit errors and cancels the response body", async () => {
    const cancel = vi.fn();
    const request = vi.fn<DavFetch>().mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-length": String(MAX_DAV_TEXT + 1) }
      })
    );
    await expect(
      flush(new WebDavSyncTransport(config, password, request).get("item.json"))
    ).rejects.toThrow("同步文件超过安全读取限制。");
    expect(cancel).toHaveBeenCalled();
  });

  it("keeps bounded retry and cancellation behavior", async () => {
    const request = vi
      .fn<DavFetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 503, headers: { "retry-after": "1" } })
      )
      .mockResolvedValueOnce(new Response("content"));
    const transport = new WebDavSyncTransport(config, password, request);
    await expect(flush(transport.get("item.json"))).resolves.toBe("content");
    expect(request).toHaveBeenCalledTimes(2);
    const signal = AbortSignal.abort();
    await expect(flush(transport.get("item.json", signal))).rejects.toThrow(
      "同步已取消。"
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "net::ERR_NAME_NOT_RESOLVED",
      "无法解析网盘服务器地址，请检查地址和 DNS 设置。"
    ],
    [
      "net::ERR_CERT_AUTHORITY_INVALID",
      "网盘安全证书验证失败，请检查服务器证书和系统时间。"
    ],
    [
      "net::ERR_TUNNEL_CONNECTION_FAILED",
      "无法通过代理连接网盘，请检查系统代理设置。"
    ],
    ["net::ERR_CONNECTION_RESET", "网盘连接被拒绝或中断，请检查网络后重试。"],
    ["net::ERR_CONNECTION_TIMED_OUT", "连接网盘超时，请重试。"],
    ["unknown", "无法连接网盘，请检查网络和服务器地址。"]
  ])(
    "returns a safe actionable error for %s through the IPC sanitizer",
    async (code, message) => {
      const request = vi
        .fn<DavFetch>()
        .mockRejectedValue(
          new Error(
            `fetch failed https://invalid-user:invalid-password@example.test/?token=invalid-test-token`,
            { cause: new Error(code) }
          )
        );
      const error: unknown = await flush(
        new WebDavSyncTransport(config, password, request).get("item.json")
      ).catch((value) => value);
      expect(syncErrorMessage(error)).toBe(message);
      expect(String(error)).not.toMatch(
        /invalid-password|invalid-test-token|example\.test/
      );
    }
  );
});
