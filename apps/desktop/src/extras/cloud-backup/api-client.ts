import type { CloudBackupApiConfig } from "./config";

export interface CloudBackupObjectStore {
  getObject(key: string): Promise<Buffer | null>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}

export class DeepwriteApiObjectStore implements CloudBackupObjectStore {
  constructor(
    private readonly config: CloudBackupApiConfig,
    private readonly fetcher: typeof fetch
  ) {}

  async getObject(key: string): Promise<Buffer | null> {
    return this.request("GET", key);
  }
  async putObject(
    key: string,
    body: Buffer,
    contentType: string
  ): Promise<void> {
    await this.request("PUT", key, body, contentType);
  }
  private async request(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string
  ): Promise<Buffer | null> {
    const match =
      /^backups\/(DW-(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4})\/(manifest\.json|snapshot\.zip)$/u.exec(
        key
      );
    if (!match) throw new Error("备份对象路径无效。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10 * 60_000);
    try {
      const response = await this.fetcher(
        `${this.config.baseUrl}/deepwrite/v1/backups/${match[2]}`,
        {
          method,
          redirect: "error",
          signal: controller.signal,
          headers: {
            "X-Backup-Key": match[1]!,
            ...(contentType ? { "Content-Type": contentType } : {})
          },
          ...(body ? { body: new Uint8Array(body) } : {})
        }
      );
      if (method === "GET" && response.status === 404) return null;
      if (!response.ok)
        throw new Error(`云端备份操作失败（${response.status}）。`);
      if (method === "PUT") return null;
      const limit =
        match[2] === "manifest.json" ? 4 * 1024 * 1024 : 100 * 1024 * 1024;
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("云端备份内容为空。");
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new Error("云端备份超过大小限制。");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "marketplace.unauthorized"
      )
        throw error;
      if (controller.signal.aborted) throw new Error("连接云端备份超时。");
      // Do not expose request URLs, headers or upstream error payloads.
      if (error instanceof Error && error.message.startsWith("云端备份"))
        throw error;
      throw new Error("连接云端备份失败。");
    } finally {
      clearTimeout(timer);
    }
  }
}
