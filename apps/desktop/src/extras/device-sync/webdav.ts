import {
  syncConfigSchema,
  syncPathSchema,
  type SyncConfig,
  type SyncTransport
} from "@deepwrite/contracts";
import { parseDavNames } from "./webdav-directory";
import { davError } from "./webdav-errors";
import { WebDavHttpClient, type DavFetch } from "./webdav-http";
export { parseDavNames } from "./webdav-directory";

export class WebDavSyncTransport implements SyncTransport {
  private readonly base: URL;
  private readonly endpoint: URL;
  private readonly http: WebDavHttpClient;
  private readonly folders = new Set<string>();
  constructor(config: SyncConfig, password: string, request: DavFetch = fetch) {
    const checked = syncConfigSchema.parse(config);
    const endpoint = checked.endpoint.replace(/\/+$/, "");
    this.endpoint = new URL(`${endpoint}/`);
    this.base = new URL(
      `${endpoint}/${checked.directory.split("/").map(encodeURIComponent).join("/")}/`
    );
    this.http = new WebDavHttpClient(
      this.endpoint,
      this.base,
      `Basic ${Buffer.from(`${checked.username}:${password}`, "utf8").toString("base64")}`,
      request
    );
  }
  private url(path: string): URL {
    if (!path) return this.base;
    syncPathSchema.parse(path);
    return new URL(
      path.split("/").map(encodeURIComponent).join("/"),
      this.base
    );
  }
  async get(path: string, signal?: AbortSignal): Promise<string | null> {
    const response = await this.http.send(
      this.url(path),
      "GET",
      undefined,
      signal
    );
    if (response.status === 404) return null;
    if (response.status !== 200) throw davError(response.status);
    return response.content;
  }
  async put(
    path: string,
    content: string,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.http.send(
      this.url(path),
      "PUT",
      content,
      signal
    );
    if (![200, 201, 204].includes(response.status))
      throw davError(response.status);
  }
  async mkdir(path: string, signal?: AbortSignal): Promise<void> {
    if (path) syncPathSchema.parse(path);
    const directory = this.base.pathname
      .slice(this.endpoint.pathname.length)
      .replace(/\/$/, "")
      .split("/");
    for (let depth = 1; depth < directory.length; depth++) {
      const parent = new URL(
        directory.slice(0, depth).join("/") + "/",
        this.endpoint
      );
      const response = await this.http.send(parent, "MKCOL", undefined, signal);
      if (![200, 201, 204, 405].includes(response.status))
        throw davError(response.status);
    }
    const parts = path ? path.split("/") : [];
    for (let depth = 0; depth <= parts.length; depth++) {
      const current = parts.slice(0, depth).join("/");
      if (this.folders.has(current)) continue;
      const response = await this.http.send(
        this.url(current),
        "MKCOL",
        undefined,
        signal
      );
      if (![200, 201, 204, 405].includes(response.status))
        throw davError(response.status);
      this.folders.add(current);
    }
  }
  async list(path: string, signal?: AbortSignal): Promise<string[]> {
    let url = this.url(path);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
    const names = new Set<string>();
    const visited = new Set<string>();
    for (let page = 0; page < 256; page++) {
      if (visited.has(url.href))
        throw new Error("网盘分页重复，未使用不完整目录。");
      visited.add(url.href);
      const response = await this.http.send(
        url,
        "PROPFIND",
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
        signal
      );
      if (response.status === 404) return [];
      if (response.status !== 207) throw davError(response.status);
      const entries = parseDavNames(response.content, url);
      entries.forEach((name) => names.add(name));
      const next = response.headers
        .get("link")
        ?.match(/<([^>]+)>;\s*rel="?next"?/i)?.[1];
      if (!next) {
        if (entries.length >= 750)
          throw new Error("网盘目录可能被截断，未使用不完整列表。");
        return [...names].sort();
      }
      const following = new URL(next, url);
      if (
        following.pathname !== url.pathname ||
        following.origin !== url.origin ||
        following.username ||
        following.password
      )
        throw new Error("网盘分页地址无效。");
      url = following;
    }
    throw new Error("网盘目录分页过多。");
  }
  async remove(path: string, signal?: AbortSignal): Promise<void> {
    const response = await this.http.send(
      this.url(path),
      "DELETE",
      undefined,
      signal
    );
    if (![200, 204, 404].includes(response.status))
      throw davError(response.status);
  }
  async test(signal?: AbortSignal): Promise<void> {
    await this.mkdir("", signal);
    await this.list("", signal);
    const path = `connection-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const payload = '{"schemaVersion":1,"kind":"connection-test"}';
    try {
      await this.put(path, payload, signal);
      if ((await this.get(path, signal)) !== payload)
        throw new Error("网盘读写验证失败。");
    } catch (error) {
      await this.remove(path, signal).catch(() => {});
      throw error;
    }
    await this.remove(path, signal);
  }
}
