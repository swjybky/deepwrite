import { davError, davNetworkError, WebDavError } from "./webdav-errors";

export type DavFetch = (url: string, init: RequestInit) => Promise<Response>;
export const MAX_DAV_TEXT = 32 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new WebDavError("同步已取消。"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DAV_TEXT) {
    await response.body?.cancel();
    throw new WebDavError("同步文件超过安全读取限制。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DAV_TEXT) {
        await reader.cancel();
        throw new WebDavError("同步文件超过安全读取限制。");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

export class WebDavHttpClient {
  private nextRequestAt = 0;
  constructor(
    private readonly endpoint: URL,
    private readonly base: URL,
    private readonly authorization: string,
    private readonly request: DavFetch
  ) {}

  private async follow(
    initial: URL,
    method: string,
    body: string | undefined,
    signal: AbortSignal
  ): Promise<Response> {
    let url = initial;
    let authenticated = true;
    const visited = new Set<string>();
    for (let hop = 0; hop <= 5; hop++) {
      if (visited.has(url.href)) break;
      visited.add(url.href);
      signal.throwIfAborted();
      const response = await this.request(url.href, {
        method,
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: {
          ...(authenticated ? { Authorization: this.authorization } : {}),
          ...(method === "PROPFIND"
            ? { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }
            : { "Content-Type": "application/json; charset=utf-8" })
        },
        ...(body === undefined ? {} : { body })
      });
      if (!REDIRECTS.has(response.status)) return response;
      await response.body?.cancel();
      let next: URL | undefined;
      try {
        const location = response.headers.get("location");
        if (location) next = new URL(location, url);
      } catch {
        /* Report only a safe message below. */
      }
      const sameResource =
        next &&
        next.origin === initial.origin &&
        next.pathname.replace(/\/$/, "") ===
          initial.pathname.replace(/\/$/, "") &&
        next.search === initial.search;
      // File downloads may use a signed CDN URL. All other methods stay on the
      // original resource (including a server's trailing-slash normalization).
      if (
        !next ||
        next.protocol !== "https:" ||
        next.username ||
        next.password ||
        next.hash ||
        (method !== "GET" && (!sameResource || response.status === 303))
      ) {
        throw new WebDavError(
          "网盘重定向地址不安全，请填写服务商提供的 HTTPS WebDAV 直连地址。"
        );
      }
      // Once a download leaves the original resource, never reattach credentials.
      authenticated = authenticated && Boolean(sameResource);
      url = next;
    }
    throw new WebDavError("网盘重定向次数过多，请检查服务器地址。");
  }

  async send(
    url: URL,
    method: string,
    body?: string,
    signal?: AbortSignal
  ): Promise<{ status: number; headers: Headers; content: string }> {
    if (
      url.origin !== this.base.origin ||
      !url.pathname.startsWith(
        method === "MKCOL" ? this.endpoint.pathname : this.base.pathname
      )
    )
      throw new WebDavError("请求超出同步目录。");
    for (let attempt = 0; attempt < 4; attempt++) {
      await wait(Math.max(0, this.nextRequestAt - Date.now()), signal);
      this.nextRequestAt = Date.now() + 150;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = setTimeout(abort, 30_000);
      signal?.addEventListener("abort", abort, { once: true });
      let retryDelay: number;
      try {
        if (signal?.aborted) throw new WebDavError("同步已取消。");
        const response = await this.follow(
          url,
          method,
          body,
          controller.signal
        );
        const content = await readText(response);
        if (![429, 502, 503, 504].includes(response.status) || attempt === 3)
          return {
            status: response.status,
            headers: response.headers,
            content
          };
        const retry = response.headers.get("retry-after");
        retryDelay =
          retry && /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : 1000 * 2 ** attempt;
        if (retryDelay > 30_000) throw davError(response.status);
      } catch (error) {
        if (signal?.aborted) throw new WebDavError("同步已取消。");
        if (controller.signal.aborted)
          throw new WebDavError("连接网盘超时，请重试。");
        throw davNetworkError(error);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
      await wait(retryDelay, signal);
    }
    throw new WebDavError("连接网盘失败。");
  }
}
