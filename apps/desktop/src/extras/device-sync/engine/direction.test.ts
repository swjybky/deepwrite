import { test, expect } from "vitest";
import { DeviceSyncService } from "./service";
import {
  sameSyncContent,
  syncKey,
  type SyncItem,
  type SyncMetadata,
  type SyncTransport
} from "@deepwrite/contracts";
import { createHash } from "node:crypto";

export function item(
  body = "第一行\n第二行\n第三行\n",
  id = "book_example"
): SyncItem {
  return {
    id,
    kind: "book",
    title: "测试作品",
    files: {
      "deepwrite.json": '{"schemaVersion":4,"id":"book_example"}',
      "draft.md": body
    }
  };
}
export class MemoryDav implements SyncTransport {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  puts: string[] = [];
  beforePut: ((path: string, value: string) => Promise<void>) | null = null;
  async get(path: string) {
    return this.files.get(path) ?? null;
  }
  async put(path: string, value: string) {
    await this.beforePut?.(path, value);
    this.puts.push(path);
    this.files.set(path, value);
  }
  async mkdir(path: string) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++)
      this.folders.add(parts.slice(0, i).join("/"));
  }
  async list(path: string) {
    const prefix = `${path}/`;
    return [
      ...new Set(
        [...this.files.keys(), ...this.folders]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length).split("/")[0] ?? "")
          .filter(Boolean)
      )
    ];
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async test() {}
}
export function device(name: string, dav: MemoryDav, initial: SyncItem[] = []) {
  let metadata: SyncMetadata | null = null;
  let secret: string | null = null;
  let counter = 0;
  const workspace = new Map(initial.map((value) => [syncKey(value), value]));
  const service = new DeviceSyncService({
    runtime: {
      hash: (value) => createHash("sha256").update(value).digest("hex"),
      id: () => `${name}_${++counter}`,
      now: () => "2026-09-08T01:00:00.000Z"
    },
    metadata: {
      read: async () => (metadata ? structuredClone(metadata) : null),
      write: async (value) => {
        metadata = structuredClone(value);
      }
    },
    credentials: {
      get: async () => secret,
      set: async (value) => {
        secret = value;
      },
      delete: async () => {
        secret = null;
      }
    },
    workspace: {
      list: async () => ({ items: [...workspace.values()], issues: [] }),
      validate: async () => {},
      recover: async () => {},
      apply: async (key, expected, next) => {
        if (!sameSyncContent(expected, workspace.get(key) ?? null))
          throw new Error("stale");
        if (next) workspace.set(key, structuredClone(next));
        else workspace.delete(key);
      }
    },
    transport: () => dav
  });
  return { service, workspace, metadata: () => metadata };
}
export async function connect(
  client: ReturnType<typeof device>,
  space: string | null = null
) {
  await client.service.connect(
    {
      schemaVersion: 1,
      provider: "webdav",
      endpoint: "https://example.test/dav",
      username: "test-user",
      directory: "DeepWriteSync",
      deviceName: "测试设备",
      spaceId: space,
      excludedKeys: []
    },
    "invalid-test-password"
  );
  const status = await client.service.join(space);
  return status.config?.spaceId ?? "";
}

import { syncPresentation } from "../../../renderer/src/extras/device-sync/presentation";

async function pair() {
  const dav = new MemoryDav();
  const pc = device("pc", dav, [item(), item("另一篇原文", "book_other")]);
  const phone = device("phone", dav);
  const space = await connect(pc);
  await pc.service.sync([], true);
  await connect(phone, space);
  await phone.service.sync([], true);
  return { dav, pc, phone };
}

test("空本机先预览，再确认从远端初始化作品", async () => {
  const dav = new MemoryDav();
  const remoteItem = item("远端初始化正文");
  const remote = device("remote", dav, [remoteItem]);
  const local = device("local", dav);
  const space = await connect(remote);
  await remote.service.sync([], true);
  await connect(local, space);

  const writes = dav.puts.length;
  const preview = await local.service.sync([], false);
  expect(preview.firstSyncConfirmed).toBe(false);
  expect(preview.issues.some((issue) => issue.reason === "first-sync")).toBe(
    true
  );
  expect(local.workspace.size).toBe(0);
  expect(dav.puts).toHaveLength(writes);

  const initialized = await local.service.sync([], true);
  expect(initialized.firstSyncConfirmed).toBe(true);
  expect(initialized.progress.phase).toBe("complete");
  expect(local.workspace.get(syncKey(remoteItem))).toEqual(remoteItem);
  expect(remote.workspace.get(syncKey(remoteItem))).toEqual(remoteItem);
});

test("首次对齐后仅展示本机实际修改；进页检查不上传、不下载、不推进基线", async () => {
  const { dav, pc, phone } = await pair();
  expect(syncPresentation(await phone.service.status()).uploads).toEqual([]);
  phone.workspace.set("book:book_example", item("手机新正文"));
  pc.workspace.set("book:book_other", item("电脑新正文", "book_other"));
  await pc.service.sync([], false, "upload");
  const before = phone.metadata();
  const writes = dav.puts.length;
  const status = await phone.service.check();
  const view = syncPresentation(status);
  expect(view.uploads.map((entry) => entry.key)).toEqual(["book:book_example"]);
  expect(view.downloads.map((entry) => entry.key)).toEqual(["book:book_other"]);
  expect(phone.workspace.get("book:book_other")?.files["draft.md"]).toBe(
    "另一篇原文"
  );
  expect(phone.metadata()?.baselines).toEqual(before?.baselines);
  expect(phone.metadata()?.published).toEqual(before?.published);
  expect(dav.puts).toHaveLength(writes);
});

test("上传只发布本机修改，远端更新留在待下载列表", async () => {
  const { pc, phone } = await pair();
  phone.workspace.set("book:book_example", item("手机新正文"));
  pc.workspace.set("book:book_other", item("电脑新正文", "book_other"));
  await pc.service.sync([], false, "upload");
  const result = await phone.service.sync([], false, "upload");
  expect(result.progress.title).toBe("已上传 1 项，已下载 0 项");
  expect(phone.workspace.get("book:book_other")?.files["draft.md"]).toBe(
    "另一篇原文"
  );
  expect(syncPresentation(result).uploads).toEqual([]);
  expect(syncPresentation(result).downloads).toHaveLength(1);
  const downloaded = await phone.service.sync([], false, "download");
  expect(downloaded.progress.title).toBe("已上传 0 项，已下载 1 项");
  expect(phone.workspace.get("book:book_other")?.files["draft.md"]).toBe(
    "电脑新正文"
  );
});

test("下载不发布本机其他作品的新编辑，也不清除其待上传状态", async () => {
  const { pc, phone } = await pair();
  phone.workspace.set("book:book_example", item("未上传的手机正文"));
  pc.workspace.set("book:book_other", item("电脑新正文", "book_other"));
  await pc.service.sync([], false, "upload");
  const result = await phone.service.sync([], false, "download");
  expect(result.progress.title).toBe("已上传 0 项，已下载 1 项");
  expect(syncPresentation(result).uploads).toHaveLength(1);
  await pc.service.sync();
  expect(pc.workspace.get("book:book_example")?.files["draft.md"]).toBe(
    item().files["draft.md"]
  );
});

test.each(["upload", "download"] as const)(
  "两端都修改时 %s 不静默合并另一方向，明确合并后保留双方正文",
  async (direction) => {
    const { pc, phone } = await pair();
    pc.workspace.set("book:book_example", item("电脑\n第二行\n第三行\n"));
    phone.workspace.set("book:book_example", item("第一行\n第二行\n手机\n"));
    await pc.service.sync([], false, "upload");
    const baseline = phone.metadata()?.baselines;
    const result = await phone.service.sync([], false, direction);
    expect(result.issues[0]?.message).toContain("两端修改");
    expect(result.progress.phase).toBe("partial");
    expect(phone.metadata()?.baselines["book:book_example"]).toEqual(
      baseline?.["book:book_example"]
    );
    expect(phone.workspace.get("book:book_example")?.files["draft.md"]).toBe(
      "第一行\n第二行\n手机\n"
    );
    await phone.service.sync();
    await pc.service.sync();
    expect(pc.workspace.get("book:book_example")?.files["draft.md"]).toBe(
      "电脑\n第二行\n手机\n"
    );
  }
);

test("重复同步只报告实际变化数量，并可只检查另一端收据", async () => {
  const { dav, pc, phone } = await pair();
  await pc.service.sync();
  await phone.service.sync();
  const writes = dav.puts.length;
  const result = await pc.service.sync();
  expect(result.progress).toMatchObject({
    completed: 0,
    total: 0,
    title: "检查完成，没有需要传输的修改"
  });
  expect(dav.puts).toHaveLength(writes);
  const check = await pc.service.check();
  expect(
    check.devices.find((entry) => entry.id === phone.metadata()?.deviceId)
      ?.receivedCurrent
  ).toBe(true);
  expect(syncPresentation(check).uploads).toEqual([]);
  expect(syncPresentation(check).downloads).toEqual([]);
});

test("远端独有的新作品也显示待下载；检查失败保留原记录", async () => {
  const { dav, pc, phone } = await pair();
  pc.workspace.set("book:new_remote", item("远端新作品", "new_remote"));
  await pc.service.sync([], false, "upload");
  const result = await phone.service.check();
  expect(
    syncPresentation(result).downloads.map((entry) => entry.key)
  ).toContain("book:new_remote");
  const before = phone.metadata();
  dav.list = async () => {
    throw new Error("invalid-test-network-failure");
  };
  await expect(phone.service.check()).rejects.toThrow(
    "invalid-test-network-failure"
  );
  expect(phone.metadata()).toEqual(before);
  expect((await phone.service.status()).progress.phase).toBe("failed");
});
