import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("electron", () => ({ net: { request } }));
import { electronDavFetch } from "./webdav-fetch";
import { MAX_DAV_TEXT } from "./webdav-http";

function client() {
  const value = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    abort: vi.fn(),
    followRedirect: vi.fn()
  });
  value.abort.mockImplementation(() => value.emit("abort"));
  request.mockReturnValue(value);
  return value;
}
function incoming(statusCode: number, headers: Record<string, string> = {}) {
  return Object.assign(new EventEmitter(), { statusCode, headers });
}

describe("Electron WebDAV request adapter", () => {
  beforeEach(() => request.mockReset());

  it("exposes a manual redirect before Electron cancels it", async () => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "GET",
      redirect: "manual"
    });
    native.emit(
      "redirect",
      302,
      "GET",
      "https://download.example.test/object",
      { location: ["https://download.example.test/object"] }
    );
    native.emit("error", new Error("Redirect was cancelled"));
    const response = await promise;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://download.example.test/object"
    );
    expect(native.abort).toHaveBeenCalled();
    expect(native.followRedirect).not.toHaveBeenCalled();
  });

  it("forwards explicit authentication and text without using session credentials", async () => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "PUT",
      body: "内容",
      headers: { Authorization: "Basic invalid-test-value" }
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        headers: { authorization: "Basic invalid-test-value" }
      })
    );
    expect(native.end).toHaveBeenCalledWith("内容");
    const response = incoming(201);
    native.emit("response", response);
    response.emit("data", Buffer.from("创建"));
    response.emit("data", Buffer.from("成功"));
    response.emit("end");
    expect(await (await promise).text()).toBe("创建成功");
  });

  it.each([204, 205, 304])("accepts an empty %s response", async (status) => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "DELETE"
    });
    const response = incoming(status);
    native.emit("response", response);
    response.emit("end");
    expect((await promise).body).toBeNull();
  });

  it("rejects HTTP authentication errors as responses for the transport to classify", async () => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/", {
      method: "MKCOL"
    });
    const response = incoming(401);
    native.emit("response", response);
    response.emit("end");
    expect((await promise).status).toBe(401);
  });

  it.each([true, false])(
    "bounds response buffering with declared content length: %s",
    async (declared) => {
      const native = client();
      const promise = electronDavFetch("https://example.test/dav/file.json", {
        method: "GET"
      });
      const assertion =
        expect(promise).rejects.toThrow("同步文件超过安全读取限制。");
      const response = incoming(
        200,
        declared ? { "content-length": String(MAX_DAV_TEXT + 1) } : {}
      );
      native.emit("response", response);
      if (!declared) response.emit("data", new Uint8Array(MAX_DAV_TEXT + 1));
      await assertion;
      expect(native.abort).toHaveBeenCalled();
    }
  );

  it("cancels in-flight body reads and removes the abort listener", async () => {
    const native = client();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "GET",
      signal: controller.signal
    });
    const assertion = expect(promise).rejects.toThrow("同步已取消。");
    const response = incoming(200);
    native.emit("response", response);
    response.emit("data", Buffer.from("partial"));
    controller.abort();
    response.emit("end");
    await assertion;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(native.abort).toHaveBeenCalled();
  });

  it("does not accept an incomplete response when the server aborts it", async () => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "GET"
    });
    const assertion = expect(promise).rejects.toThrow("ERR_CONNECTION_CLOSED");
    const response = incoming(200);
    native.emit("response", response);
    response.emit("aborted");
    await assertion;
  });

  it("waits for the response after Electron closes the request's writable stream", async () => {
    const native = client();
    const promise = electronDavFetch("https://example.test/dav/file.json", {
      method: "GET"
    });
    native.emit("finish");
    native.emit("close");
    const response = incoming(200);
    native.emit("response", response);
    response.emit("data", Buffer.from("content"));
    response.emit("end");
    response.emit("close");
    expect(await (await promise).text()).toBe("content");
    expect(native.abort).not.toHaveBeenCalled();
  });
});
