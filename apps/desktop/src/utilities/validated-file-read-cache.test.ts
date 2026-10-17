import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
  lstat,
  utimes,
  rename,
  unlink,
  symlink,
  link,
  mkdir
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ValidatedFileReadCache } from "./validated-file-read-cache";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture(maximumBytes = 64 * 1024, maximumEntries = 4) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-validated-cache-"))
  );
  roots.push(root);
  const parse = vi.fn((text: string) => JSON.parse(text) as { value: string });
  const cache = new ValidatedFileReadCache(maximumBytes, parse, maximumEntries);
  const path = join(root, "snapshot.json");
  await writeFile(path, '{"value":"before"}');
  return {
    root,
    path,
    parse,
    cache,
    read: () => cache.read(root, "snapshot.json", 64 * 1024, "合成快照")
  };
}

it("validates unchanged bytes once, isolates returned objects and projects small metadata", async () => {
  const { root, cache, read, parse } = await fixture();
  (await read()).value = "caller mutation";
  expect((await read()).value).toBe("before");
  expect(
    await cache.inspect(
      root,
      "snapshot.json",
      64 * 1024,
      "合成快照",
      ({ value }) => value
    )
  ).toBe("before");
  expect(parse).toHaveBeenCalledTimes(1);
});

it("invalidates same-size edits with restored mtime and atomic replacements", async () => {
  const { path, read, parse } = await fixture();
  await read();
  const before = await lstat(path);
  await writeFile(path, '{"value":"edited"}');
  await utimes(path, before.atime, before.mtime);
  expect((await read()).value).toBe("edited");
  await writeFile(`${path}.next`, '{"value":"atomic"}');
  await utimes(`${path}.next`, before.atime, before.mtime);
  await rename(`${path}.next`, path);
  expect((await read()).value).toBe("atomic");
  expect(parse).toHaveBeenCalledTimes(3);
});

it("rejects corrupted/deleted files, links and unsafe parents even with a warm cache", async () => {
  const { root, path, read, cache } = await fixture();
  await read();
  await writeFile(path, "{broken");
  await expect(read()).rejects.toThrow();
  await unlink(path);
  await expect(read()).rejects.toMatchObject({ code: "ENOENT" });
  const other = join(root, "other.json");
  await writeFile(other, '{"value":"linked"}');
  await symlink(other, path);
  // Windows opens the reparsed link so the identity guard reports a
  // replacement instead of the link kind; both reprisals are fail-safe.
  await expect(read()).rejects.toThrow(/符号链接|替换/u);
  await unlink(path);
  await link(other, path);
  await expect(read()).rejects.toThrow(/硬链接|替换/u);
  await mkdir(join(root, "actual"));
  await writeFile(join(root, "actual", "item.json"), '{"value":"parent"}');
  await symlink(join(root, "actual"), join(root, "alias"));
  await expect(
    cache.read(root, "alias/item.json", 64 * 1024, "合成快照")
  ).rejects.toThrow(/父目录/u);
});

it("evicts least-recently-read files and bypasses caching when a snapshot exceeds the memory budget", async () => {
  const { root, cache, parse, read } = await fixture(64 * 1024, 1);
  await read();
  await writeFile(join(root, "other.json"), '{"value":"second"}');
  await cache.read(root, "other.json", 64 * 1024, "合成快照");
  await read();
  expect(parse).toHaveBeenCalledTimes(3);
  const tiny = new ValidatedFileReadCache(1, parse);
  await tiny.read(root, "snapshot.json", 64 * 1024, "合成快照");
  await tiny.read(root, "snapshot.json", 64 * 1024, "合成快照");
  expect(parse).toHaveBeenCalledTimes(5);
});
