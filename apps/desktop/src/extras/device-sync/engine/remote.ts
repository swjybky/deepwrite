import {
  clockIncludes,
  checkedSyncItem,
  stableSyncJson,
  syncCommitSchema,
  syncHeadSchema,
  syncIdSchema,
  syncKey,
  syncPackSchema,
  syncSpaceSchema,
  type LoadedSyncDevice,
  type SyncClock,
  type SyncCommit,
  type SyncItem,
  type SyncRevision,
  type SyncRuntime,
  type SyncSpace,
  type SyncTransport
} from "@deepwrite/contracts";

export class SyncRemote {
  private fileProgress:
    ((completed: number, total: number) => void) | undefined;
  setFileProgress(listener: (completed: number, total: number) => void): void {
    this.fileProgress = listener;
  }
  private readonly packs = new Map<string, Record<string, string>>();
  constructor(
    private readonly transport: SyncTransport,
    private readonly runtime: SyncRuntime,
    private readonly signal?: AbortSignal
  ) {}

  async spaces(): Promise<SyncSpace[]> {
    await this.transport.mkdir("spaces", this.signal);
    const result: SyncSpace[] = [];
    for (const id of await this.transport.list("spaces", this.signal)) {
      if (!syncIdSchema.safeParse(id).success) continue;
      const text = await this.transport.get(
        `spaces/${id}/space.json`,
        this.signal
      );
      if (!text) continue;
      const space = syncSpaceSchema.parse(JSON.parse(text));
      if (space.id !== id) throw new Error("同步空间身份不一致。");
      const devices = await this.devices(space.id);
      const revisions = devices.flatMap(({ commit }) =>
        Object.entries(commit.items)
      );
      const visible = revisions.filter(
        ([key, revision]) =>
          revision.files &&
          !revisions.some(
            ([otherKey, other]) =>
              key === otherKey &&
              !other.files &&
              clockIncludes(other.clock, revision.clock)
          )
      );
      result.push({
        ...space,
        itemCount: new Set(visible.map(([key]) => key)).size,
        lastUpdatedAt:
          devices
            .map(({ commit }) => commit.createdAt)
            .sort()
            .at(-1) ?? space.createdAt
      });
    }
    return result;
  }
  async createSpace(name: string): Promise<SyncSpace> {
    const space = syncSpaceSchema.parse({
      schemaVersion: 1,
      id: this.runtime.id(),
      name,
      createdAt: this.runtime.now()
    });
    await this.transport.mkdir(`spaces/${space.id}`, this.signal);
    await this.transport.put(
      `spaces/${space.id}/space.json`,
      stableSyncJson(space),
      this.signal
    );
    return space;
  }
  async devices(spaceId: string): Promise<LoadedSyncDevice[]> {
    const root = `spaces/${syncIdSchema.parse(spaceId)}/devices`;
    const devices: LoadedSyncDevice[] = [];
    for (const id of await this.transport.list(root, this.signal)) {
      if (!syncIdSchema.safeParse(id).success) continue;
      const directory = `${root}/${id}`;
      const head = await this.transport.get(
        `${directory}/head.json`,
        this.signal
      );
      let loaded: LoadedSyncDevice | null = null;
      if (head) {
        const ref = syncHeadSchema.safeParse(parseRemoteJson(head));
        if (ref.success)
          loaded = await this.readCommit(
            directory,
            ref.data.sequence,
            ref.data.hash,
            spaceId,
            id
          );
      }
      if (!loaded) {
        const groups = (
          await this.transport.list(`${directory}/commits`, this.signal)
        )
          .filter((name) => /^\d{10}$/.test(name))
          .sort()
          .reverse();
        const candidates: string[] = [];
        for (const group of groups) {
          const names = (
            await this.transport.list(
              `${directory}/commits/${group}`,
              this.signal
            )
          )
            .filter((name) => /^\d{12}-[a-f0-9]{64}\.json$/.test(name))
            .sort()
            .reverse();
          candidates.push(...names);
          if (names.length) break;
        }
        if (candidates.length === 0 && head)
          throw new Error("设备同步记录损坏，请从历史恢复。");
        for (const name of candidates) {
          const sequence = Number(name.slice(0, 12));
          const hash = name.slice(13, -5);
          loaded = await this.readCommit(
            directory,
            sequence,
            hash,
            spaceId,
            id
          );
          if (loaded) break;
        }
        if (candidates.length > 0 && !loaded)
          throw new Error("设备同步记录无法验证。");
      }
      if (loaded) devices.push(loaded);
    }
    return devices;
  }
  private commitGroup(sequence: number): string {
    return String(Math.floor((sequence - 1) / 256)).padStart(10, "0");
  }
  private async readCommit(
    directory: string,
    sequence: number,
    hash: string,
    spaceId: string,
    deviceId: string
  ): Promise<LoadedSyncDevice | null> {
    const text = await this.transport.get(
      `${directory}/commits/${this.commitGroup(sequence)}/${String(sequence).padStart(12, "0")}-${hash}.json`,
      this.signal
    );
    if (!text || this.runtime.hash(text) !== hash) return null;
    const parsed = syncCommitSchema.safeParse(parseRemoteJson(text));
    if (!parsed.success) return null;
    const commit = parsed.data;
    if (
      commit.spaceId !== spaceId ||
      commit.deviceId !== deviceId ||
      commit.sequence !== sequence ||
      Object.entries(commit.items).some(
        ([key, value]) => key !== syncKey(value)
      )
    )
      return null;
    return { hash, commit };
  }
  async item(
    spaceId: string,
    revision: SyncRevision
  ): Promise<SyncItem | null> {
    if (!revision.files) return null;
    const files: Record<string, string> = {};
    let completed = 0;
    this.fileProgress?.(0, Object.keys(revision.files).length);
    for (const [path, ref] of Object.entries(revision.files)) {
      let pack = this.packs.get(ref.pack);
      if (!pack) {
        const text = await this.transport.get(
          `spaces/${spaceId}/objects/${ref.pack.slice(0, 2)}/${ref.pack}.json`,
          this.signal
        );
        if (!text || this.runtime.hash(text) !== ref.pack)
          throw new Error("同步内容不完整或校验失败。");
        pack = syncPackSchema.parse(JSON.parse(text)).files;
        this.packs.set(ref.pack, pack);
      }
      const content = pack[ref.hash];
      if (content === undefined || this.runtime.hash(content) !== ref.hash)
        throw new Error("同步文件校验失败。");
      files[path] = content;
      this.fileProgress?.(++completed, Object.keys(revision.files).length);
    }
    return checkedSyncItem({
      kind: revision.kind,
      id: revision.id,
      title: revision.title,
      files
    });
  }
  async revision(
    spaceId: string,
    item: SyncItem | null,
    identity: Pick<SyncItem, "kind" | "id" | "title">,
    clock: SyncClock,
    previous: SyncRevision[]
  ): Promise<SyncRevision> {
    if (!item) return { ...identity, clock, files: null };
    const refs = new Map(
      previous
        .flatMap((entry) => Object.values(entry.files ?? {}))
        .map((ref) => [ref.hash, ref])
    );
    const files: NonNullable<SyncRevision["files"]> = {};
    let batch: Record<string, string> = {};
    let size = 0;
    const flush = async () => {
      if (!Object.keys(batch).length) return;
      const text = stableSyncJson({ schemaVersion: 1, files: batch });
      const pack = this.runtime.hash(text);
      const path = `spaces/${spaceId}/objects/${pack.slice(0, 2)}/${pack}.json`;
      const existing = await this.transport.get(path, this.signal);
      if (existing !== null && this.runtime.hash(existing) !== pack)
        throw new Error("云端已有内容损坏，未覆盖。");
      if (existing === null) {
        await this.transport.mkdir(
          `spaces/${spaceId}/objects/${pack.slice(0, 2)}`,
          this.signal
        );
        await this.transport.put(path, text, this.signal);
        const verified = await this.transport.get(path, this.signal);
        if (!verified || this.runtime.hash(verified) !== pack)
          throw new Error("上传内容读回校验失败。");
      }
      for (const hash of Object.keys(batch)) refs.set(hash, { hash, pack });
      this.packs.set(pack, batch);
      batch = {};
      size = 0;
    };
    for (const content of Object.values(item.files)) {
      const hash = this.runtime.hash(content);
      if (refs.has(hash) || batch[hash] !== undefined) continue;
      if (size + content.length > 512_000) await flush();
      batch[hash] = content;
      size += content.length;
    }
    await flush();
    let completed = 0;
    this.fileProgress?.(0, Object.keys(item.files).length);
    for (const [path, content] of Object.entries(item.files)) {
      const ref = refs.get(this.runtime.hash(content));
      if (!ref) throw new Error("缺少文件上传记录。");
      files[path] = ref;
      this.fileProgress?.(++completed, Object.keys(item.files).length);
    }
    return { kind: item.kind, id: item.id, title: item.title, clock, files };
  }
  async publish(commit: SyncCommit): Promise<string> {
    const text = stableSyncJson(syncCommitSchema.parse(commit));
    const hash = this.runtime.hash(text);
    const root = `spaces/${commit.spaceId}/devices/${commit.deviceId}`;
    await this.transport.mkdir(
      `${root}/commits/${this.commitGroup(commit.sequence)}`,
      this.signal
    );
    const path = `${root}/commits/${this.commitGroup(commit.sequence)}/${String(commit.sequence).padStart(12, "0")}-${hash}.json`;
    await this.transport.put(path, text, this.signal);
    if ((await this.transport.get(path, this.signal)) !== text)
      throw new Error("同步提交读回校验失败。");
    await this.transport.put(
      `${root}/head.json`,
      stableSyncJson({ schemaVersion: 1, hash, sequence: commit.sequence }),
      this.signal
    );
    return hash;
  }
}

// Only malformed data triggers immutable-commit recovery. Transport failures
// must reach the caller, rather than being mistaken for damaged records.
function parseRemoteJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
