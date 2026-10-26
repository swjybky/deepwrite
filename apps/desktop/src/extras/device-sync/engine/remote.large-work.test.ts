import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { SyncItem, SyncRevision } from "@deepwrite/contracts";
import { SyncRemote } from "./remote";
import { MemoryDav, connect, device } from "./sync-test-support";

const runtime = {
  hash: (value: string) => createHash("sha256").update(value).digest("hex"),
  id: () => "large_work_fixture",
  now: () => "2026-10-22T00:00:00.000Z"
};
function fixture(signal?: AbortSignal) {
  const files: Record<string, string> = {
    "deepwrite.json": "{}",
    "long/index.json": "{}"
  };
  for (let i = 0; i < 12_000; i++)
    files[`long/chapters/chapter_${i}/body.md`] = "合成正文";
  const item: SyncItem = {
    kind: "long-book",
    id: "longbook_large_fixture",
    title: "合成整书",
    files
  };
  const revision: SyncRevision = {
    kind: item.kind,
    id: item.id,
    title: item.title,
    clock: { source: 1 },
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        { hash: runtime.hash(content), pack: "a".repeat(64) }
      ])
    )
  };
  const dav = new MemoryDav();
  const remote = new SyncRemote(dav, runtime, signal);
  return { item, revision, dav, remote };
}

it.each([true, false])(
  "上万缓存文件接收时主线程仍可处理事件，文件总数不重复遍历（进度=%s）",
  async (withProgress) => {
    const f = fixture();
    await f.remote.reuseItems([f.item]);
    let traversals = 0;
    f.revision.files = new Proxy(f.revision.files!, {
      ownKeys(target) {
        traversals++;
        return Reflect.ownKeys(target);
      }
    });
    let turnRan = false;
    let finalProgress: number[] = [];
    if (withProgress)
      f.remote.setFileProgress((done, total) => {
        finalProgress = [done, total];
      });
    setImmediate(() => {
      turnRan = true;
    });
    const get = vi.spyOn(f.dav, "get");
    const result = await f.remote.item("space_fixture", f.revision);
    expect(turnRan).toBe(true);
    expect(traversals).toBeLessThan(5);
    expect(result?.files).toEqual(f.item.files);
    expect(get).not.toHaveBeenCalled();
    if (withProgress) expect(finalProgress).toEqual([12_002, 12_002]);
  }
);

it("上万已知文件创建上传版本时让出主线程，并保持文件引用和进度完整", async () => {
  const f = fixture();
  let traversals = 0;
  f.item.files = new Proxy(f.item.files, {
    ownKeys(target) {
      traversals++;
      return Reflect.ownKeys(target);
    }
  });
  let turnRan = false;
  let finalProgress: number[] = [];
  f.remote.setFileProgress((done, total) => {
    finalProgress = [done, total];
  });
  setImmediate(() => {
    turnRan = true;
  });
  const get = vi.spyOn(f.dav, "get");
  const result = await f.remote.revision(
    "space_fixture",
    f.item,
    f.item,
    { source: 2 },
    [f.revision]
  );
  expect(turnRan).toBe(true);
  expect(traversals).toBeLessThan(5);
  expect(result.files).toEqual(f.revision.files);
  expect(finalProgress).toEqual([12_002, 12_002]);
  expect(get).not.toHaveBeenCalled();
});

it.each(["download", "reuse", "upload", "revision"] as const)(
  "%s 处理缓存和重复内容时仍能取消，且不发布不完整版本",
  async (stage) => {
    const controller = new AbortController();
    const f = fixture(controller.signal);
    if (stage === "download") await f.remote.reuseItems([f.item]);
    const get = vi.spyOn(f.dav, "get");
    const put = vi.spyOn(f.dav, "put");
    setImmediate(() => controller.abort());
    const known = new Map(
      Object.values(f.revision.files!).map((ref) => [ref.hash, ref])
    );
    const pending =
      stage === "download"
        ? f.remote.item("space_fixture", f.revision)
        : stage === "reuse"
          ? f.remote.reuseItems([f.item])
          : stage === "upload"
            ? f.remote.uploadContents(
                "space_fixture",
                Object.values(f.item.files),
                known
              )
            : f.remote.revision(
                "space_fixture",
                f.item,
                f.item,
                { source: 2 },
                [f.revision]
              );
    await expect(pending).rejects.toThrow("同步已取消");
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  }
);

it("大体量同步期间可以轮询并取消，结束后可重新同步", async () => {
  const f = fixture();
  const client = device("source", f.dav, [f.item]);
  await connect(client);
  let poll: ReturnType<typeof client.service.status> | undefined;
  setImmediate(() => {
    poll = client.service.status();
    client.service.cancel();
  });
  expect((await client.service.sync([], true)).progress.phase).toBe(
    "cancelled"
  );
  expect(poll).toBeDefined();
  await poll;
  expect(client.metadata()?.published).toBeNull();
  expect((await client.service.sync([], true)).progress.phase).toBe("complete");
});
