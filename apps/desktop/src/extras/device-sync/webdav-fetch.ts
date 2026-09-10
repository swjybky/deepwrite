import { net } from "electron";
import { WebDavError } from "./webdav-errors";
import { MAX_DAV_TEXT, type DavFetch } from "./webdav-http";

function responseHeaders(values: Record<string, string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value])
      headers.append(name, entry);
  }
  return headers;
}

// Electron net.fetch rejects manual redirects instead of exposing the 3xx
// response. Use net.request so the transport can validate each hop itself.
export const electronDavFetch: DavFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: init.method ?? "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      bypassCustomProtocolHandlers: true,
      headers: Object.fromEntries(new Headers(init.headers))
    });
    let finished = false;
    const cleanup = () => init.signal?.removeEventListener("abort", abort);
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
      request.abort();
    };
    const abort = () => fail(new WebDavError("同步已取消。"));
    const complete = (response: Response) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(response);
    };
    request.on("error", fail);
    request.on("abort", () => fail(new Error("ERR_CONNECTION_CLOSED")));
    request.on("redirect", (status, _method, location, rawHeaders) => {
      const headers = responseHeaders(rawHeaders);
      headers.set("location", location);
      complete(new Response(null, { status, headers }));
      request.abort();
    });
    request.on("response", (response) => {
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("ERR_CONNECTION_CLOSED")));
      const headers = responseHeaders(response.headers);
      if (Number(headers.get("content-length") ?? 0) > MAX_DAV_TEXT) {
        fail(new WebDavError("同步文件超过安全读取限制。"));
        return;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      response.on("end", () => {
        if (finished) return;
        const body =
          init.method === "HEAD" ||
          [204, 205, 304].includes(response.statusCode)
            ? null
            : new Uint8Array(Buffer.concat(chunks, size));
        complete(new Response(body, { status: response.statusCode, headers }));
      });
      response.on("data", (chunk) => {
        if (finished) return;
        size += chunk.byteLength;
        if (size > MAX_DAV_TEXT) {
          fail(new WebDavError("同步文件超过安全读取限制。"));
          return;
        }
        chunks.push(chunk);
      });
    });
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) {
      abort();
      return;
    }
    if (
      init.body !== undefined &&
      init.body !== null &&
      typeof init.body !== "string"
    ) {
      fail(new TypeError("WebDAV request body must be text"));
      return;
    }
    request.end(init.body ?? undefined);
  });
