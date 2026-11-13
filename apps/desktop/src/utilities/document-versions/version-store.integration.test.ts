import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT_VERSION_LIMIT, safeSyncFile } from "@deepwrite/contracts";
import { DocumentVersionStore, documentVersionCurrent } from "./version-store";
import { readDeviceSyncFiles } from "../device-sync-files";

const roots: string[] = [];
const origin = {
  sessionId: "session_versions",
  runId: "run_one",
  summary: "修改正文"
};
async function fixture(maxBytes = 1024) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-versions-"))
  );
  roots.push(root);
  return {
    root,
    store: new DocumentVersionStore(
      root,
      {
        workspace: "catalog",
        bookId: "book_versions",
        documentId: "draft_versions"
      },
      maxBytes,
      () => "2026-11-11T10:00:00.000Z"
    )
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

describe("document version durable storage", () => {
  it("skips empty, oversized, and unchanged text without creating storage", async () => {
    const { root, store } = await fixture(5);
    await store.capture("", "", origin);
    await store.capture("", "界界", origin);
    expect(await readdir(root)).toEqual([]);
    expect(await store.list()).toEqual([]);
    await store.capture("", "甲", origin);
    const before = await readFile(join(store.directory, "index.json"));
    await store.capture("甲", "甲", origin);
    expect(await readFile(join(store.directory, "index.json"))).toEqual(before);
  });

  it("stores full gzip text and coalesces a run while cleaning old blobs", async () => {
    const { store } = await fixture();
    await store.capture("", "甲", origin);
    await store.capture("甲", "甲乙", origin);
    await store.capture("甲乙", "丙", { ...origin, runId: "run_two" });
    const listed = await store.list();
    expect(listed.map(({ seq }) => seq)).toEqual([2, 1]);
    expect((await store.read(listed[1]!.id)).content).toBe("甲乙");
    expect(
      gunzipSync(
        await readFile(join(store.directory, `${listed[0]!.id}.md.gz`))
      ).toString("utf8")
    ).toBe("丙");
    expect(
      (await readdir(store.directory)).filter((name) => name.endsWith(".md.gz"))
    ).toHaveLength(2);
  });

  it("preserves manual content and can restore a restore's previous text", async () => {
    const { store } = await fixture();
    await store.capture("手写", "智能体", origin);
    const first = (await store.list()).at(-1)!;
    const restored = await store.restore("手动修改", "手写", first.seq);
    expect(restored).toMatchObject({
      kind: "restore",
      seq: 4,
      restoredFromSeq: 1
    });
    const beforeRestore = (await store.list()).find(
      ({ reason }) => reason === "restore"
    )!;
    expect((await store.read(beforeRestore.id)).content).toBe("手动修改");
    await store.restore("手写", "手动修改", beforeRestore.seq);
    expect((await store.list())[0]).toMatchObject({
      seq: 5,
      kind: "restore",
      restoredFromSeq: 3
    });
  });

  it("rejects missing, truncated, tampered and symlinked version files", async () => {
    const { root, store } = await fixture();
    await store.capture("", "文本", origin);
    const version = (await store.list())[0]!;
    const path = join(store.directory, `${version.id}.md.gz`);
    const bytes = await readFile(path);
    await writeFile(path, bytes.subarray(0, 5));
    await expect(store.read(version.id)).rejects.toMatchObject({
      code: "version.unavailable"
    });
    await unlink(path);
    await expect(store.read(version.id)).rejects.toMatchObject({
      code: "version.unavailable"
    });
    const outside = join(root, "outside.gz");
    await writeFile(outside, bytes);
    await symlink(outside, path);
    await expect(store.read(version.id)).rejects.toMatchObject({
      code: "version.unavailable"
    });
  });

  it("archives malformed or foreign indexes before rebuilding from the current text", async () => {
    const { store } = await fixture();
    await store.capture("", "甲", origin);
    await writeFile(join(store.directory, "index.json"), "{");
    await store.capture("乙", "丙", origin);
    expect((await store.list()).map(({ kind }) => kind)).toEqual([
      "conversation",
      "pre_conversation"
    ]);
    expect(
      (await readdir(store.directory)).some((name) =>
        name.startsWith("index.corrupt-")
      )
    ).toBe(true);
    const json = JSON.parse(
      await readFile(join(store.directory, "index.json"), "utf8")
    );
    json.target.bookId = "book_other";
    await writeFile(join(store.directory, "index.json"), JSON.stringify(json));
    await store.capture("丙", "丁", origin);
    expect((await store.list()).at(-1)).toMatchObject(
      documentVersionCurrent("丙")
    );
  });

  it("retains only 100 entries without reusing sequence numbers, and removes orphan blobs", async () => {
    const { store } = await fixture();
    for (let i = 1; i <= DOCUMENT_VERSION_LIMIT + 1; i += 1)
      await store.capture(i === 1 ? "" : `${i - 1}`, `${i}`, {
        ...origin,
        runId: `run_${i}`
      });
    const versions = await store.list();
    expect(versions).toHaveLength(100);
    expect(versions[0]!.seq).toBe(101);
    expect(versions.at(-1)!.seq).toBe(2);
    await writeFile(join(store.directory, "v999-12345678.md.gz"), "orphan");
    await store.capture("101", "102", { ...origin, runId: "run_102" });
    expect(
      (await readdir(store.directory)).filter((name) => name.endsWith(".md.gz"))
    ).toHaveLength(100);
  });

  it("never exports version history through device sync", async () => {
    const { root, store } = await fixture();
    await store.capture("", "正文", origin);
    await writeFile(join(root, "chapter.md"), "正文");
    expect(await readDeviceSyncFiles(root)).toEqual({ "chapter.md": "正文" });
    expect(safeSyncFile(".deepwrite/versions/key/index.json")).toBe(false);
    expect(safeSyncFile(".deepwrite/versions/key/v1-12345678.md.gz")).toBe(
      false
    );
  });
});
