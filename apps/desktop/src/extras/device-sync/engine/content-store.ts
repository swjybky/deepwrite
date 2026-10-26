import {
  stableSyncJson,
  syncPackSchema,
  type SyncFileRef,
  type SyncItem,
  type SyncRuntime,
  type SyncTransport
} from "@deepwrite/contracts";
import { syncWorkCheckpoint } from "./work-scheduler";

export class SyncContentIntegrityError extends Error {}

/** Content-addressed packs shared by works and conversation synchronization. */
export class SyncContentStore {
  private readonly packs = new Map<string, Record<string, string>>();
  private readonly contents = new Map<string, string>();
  constructor(
    private readonly transport: SyncTransport,
    private readonly runtime: SyncRuntime,
    private readonly signal?: AbortSignal
  ) {}

  async reuse(items: (SyncItem | null)[]): Promise<void> {
    let completed = 0;
    for (const item of items)
      for (const content of Object.values(item?.files ?? {})) {
        await syncWorkCheckpoint(++completed, this.signal);
        this.contents.set(this.runtime.hash(content), content);
      }
  }

  async read(spaceId: string, ref: SyncFileRef): Promise<string> {
    if (this.signal?.aborted) throw new Error("同步已取消。");
    const cached = this.contents.get(ref.hash);
    if (cached !== undefined) return cached;
    let pack = this.packs.get(ref.pack);
    if (!pack) {
      const text = await this.transport.get(
        `spaces/${spaceId}/objects/${ref.pack.slice(0, 2)}/${ref.pack}.json`,
        this.signal
      );
      if (!text || this.runtime.hash(text) !== ref.pack)
        throw new SyncContentIntegrityError("同步内容不完整或校验失败。");
      try {
        pack = syncPackSchema.parse(JSON.parse(text)).files;
      } catch (cause) {
        throw new SyncContentIntegrityError("同步内容不完整或校验失败。", {
          cause
        });
      }
      this.packs.set(ref.pack, pack);
    }
    const content = pack[ref.hash];
    if (content === undefined || this.runtime.hash(content) !== ref.hash)
      throw new SyncContentIntegrityError("同步文件校验失败。");
    this.contents.set(ref.hash, content);
    return content;
  }

  /** Reuse known hashes; publish each new pack only after a successful read-back. */
  async upload(
    spaceId: string,
    contents: Iterable<string>,
    known: ReadonlyMap<string, SyncFileRef> = new Map()
  ): Promise<Map<string, SyncFileRef>> {
    const refs = new Map(known);
    let batch: Record<string, string> = {};
    let size = 0;
    const flush = async () => {
      const hashes = Object.keys(batch);
      if (!hashes.length) return;
      const text = stableSyncJson({ schemaVersion: 1, files: batch });
      const pack = this.runtime.hash(text);
      const path = `spaces/${spaceId}/objects/${pack.slice(0, 2)}/${pack}.json`;
      const existing = await this.transport.get(path, this.signal);
      if (existing !== null && this.runtime.hash(existing) !== pack)
        throw new SyncContentIntegrityError("云端已有内容损坏，未覆盖。");
      if (existing === null) {
        await this.transport.mkdir(
          `spaces/${spaceId}/objects/${pack.slice(0, 2)}`,
          this.signal
        );
        await this.transport.put(path, text, this.signal);
        const verified = await this.transport.get(path, this.signal);
        if (!verified || this.runtime.hash(verified) !== pack)
          throw new SyncContentIntegrityError("上传内容读回校验失败。");
      }
      for (const hash of hashes) refs.set(hash, { hash, pack });
      this.packs.set(pack, batch);
      batch = {};
      size = 0;
    };
    let completed = 0;
    for (const content of contents) {
      await syncWorkCheckpoint(++completed, this.signal);
      const hash = this.runtime.hash(content);
      if (refs.has(hash) || batch[hash] !== undefined) continue;
      if (size + content.length > 512_000) await flush();
      batch[hash] = content;
      size += content.length;
    }
    await flush();
    return refs;
  }
}
