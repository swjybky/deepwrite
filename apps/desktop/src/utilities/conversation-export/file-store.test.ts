import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationExportFileStore } from "./file-store";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(
  options: ConstructorParameters<typeof ConversationExportFileStore>[0] = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-export-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new ConversationExportFileStore(options);
  cleanup.push(() => store.close());
  return {
    store,
    directory,
    path: join(directory, "fixture.json"),
    token: randomUUID()
  };
}

describe("conversation export file transactions", () => {
  it("requires an authorized absolute destination and deduplicates concurrent prepare and append", async () => {
    const opening = vi.fn(open);
    const test = await setup({ fileSystem: { open: opening, rename, unlink } });
    await expect(
      test.store.prepare("../../invalid", test.path)
    ).rejects.toThrow();
    await expect(
      test.store.prepare(test.token, "relative.json")
    ).rejects.toThrow();
    await Promise.all([
      test.store.prepare(test.token, test.path),
      test.store.prepare(test.token, test.path)
    ]);
    expect(opening.mock.calls.filter((call) => call[1] === "wx")).toHaveLength(
      1
    );
    await test.store.append(test.token, 0, "测试内容");
    expect(await test.store.append(test.token, 0, "测试内容")).toEqual({
      nextSeq: 1,
      bytes: 12
    });
    await expect(
      test.store.append(test.token, 0, "不同内容")
    ).rejects.toThrow();
    await expect(test.store.append(test.token, 2, "后续")).rejects.toThrow();
    await expect(
      test.store.prepare(test.token, join(test.directory, "other.json"))
    ).rejects.toThrow();
    await expect(stat(test.path)).rejects.toThrow();
    await test.store.finish(test.token, 1);
    expect(await readFile(test.path, "utf8")).toBe("测试内容");
  });

  it("retains the original destination and allows atomic completion to retry after rename fails", async () => {
    const renaming = vi
      .fn(rename)
      .mockRejectedValueOnce(new Error("测试文件暂时占用"));
    const test = await setup({
      fileSystem: { open, rename: renaming, unlink }
    });
    await writeFile(test.path, "original");
    await test.store.prepare(test.token, test.path);
    await test.store.append(test.token, 0, "replacement");
    await expect(test.store.finish(test.token, 1)).rejects.toThrow(
      "测试文件暂时占用"
    );
    expect(await readFile(test.path, "utf8")).toBe("original");
    const result = await test.store.finish(test.token, 1);
    expect(await test.store.finish(test.token, 1)).toEqual(result);
    expect(await readFile(test.path, "utf8")).toBe("replacement");
    await test.store.cancel(test.token);
    expect(await readFile(test.path, "utf8")).toBe("replacement");
    expect(await readdir(test.directory)).toEqual(["fixture.json"]);
  });

  it("poisons partially written chunks when both write and truncation fail", async () => {
    const faultOpen: typeof open = async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        const originalWrite = handle.write.bind(handle);
        vi.spyOn(handle, "write").mockImplementationOnce(async () => {
          await originalWrite(Buffer.from("unconfirmed dirty suffix"));
          throw new Error("测试磁盘写入失败");
        });
        vi.spyOn(handle, "truncate").mockRejectedValueOnce(
          new Error("测试截尾失败")
        );
      }
      return handle;
    };
    const test = await setup({
      fileSystem: { open: faultOpen, rename, unlink }
    });
    await writeFile(test.path, "original");
    await test.store.prepare(test.token, test.path);
    await expect(
      test.store.append(test.token, 0, "long chunk")
    ).rejects.toThrow("测试磁盘写入失败");
    await expect(test.store.append(test.token, 0, "x")).rejects.toThrow(
      "写入失败"
    );
    await expect(test.store.finish(test.token, 0)).rejects.toThrow("写入失败");
    await test.store.cancel(test.token);
    expect(await readFile(test.path, "utf8")).toBe("original");
    expect(await readdir(test.directory)).toEqual(["fixture.json"]);
  });

  it("cleans temporary files on cancellation and idle expiry", async () => {
    let now = 0;
    const test = await setup({ now: () => now, idleMs: 100 });
    await test.store.prepare(test.token, test.path);
    await test.store.append(test.token, 0, "unfinished");
    await test.store.cancel(test.token);
    await test.store.cancel(test.token);
    expect(await readdir(test.directory)).toEqual([]);
    const second = randomUUID();
    await test.store.prepare(second, test.path);
    now = 101;
    await test.store.expire();
    expect(await readdir(test.directory)).toEqual([]);
    await expect(test.store.append(second, 0, "late")).rejects.toThrow("过期");
  });

  it("writes past 64 MiB with individually bounded chunks", async () => {
    const test = await setup();
    await test.store.prepare(test.token, test.path);
    const text = "x".repeat(512 * 1024);
    for (let seq = 0; seq < 130; seq += 1)
      await test.store.append(test.token, seq, text);
    const result = await test.store.finish(test.token, 130);
    expect(result.bytes).toBe(65 * 1024 * 1024);
    expect((await stat(test.path)).size).toBe(result.bytes);
    await expect(test.store.append(randomUUID(), 0, text)).rejects.toThrow();
    await expect(
      test.store.append(test.token, 130, "界".repeat(400_000))
    ).rejects.toThrow();
  });
});
