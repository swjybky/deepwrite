import { rename, utimes } from "node:fs/promises";
import { afterEach, vi } from "vitest";
import * as io from "./long-project-store/io";
import { acquireProjectTransactionLock } from "./project-transaction/lock";
import { stageRecovery } from "./project-recovery.test-support";
import {
  LONG_WORKSPACE_INDEX_PATH,
  createFixture,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  lstat,
  readFile,
  symlink,
  unlink,
  writeFile
} from "./long-project-store.test-support";

afterEach(() => vi.restoreAllMocks());

describe("LongProjectStore read snapshots", () => {
  it("reuses validated metadata without reading other chapter cards or writing locks", async () => {
    const { projectStore, created } = await createFixture("read-cache");
    const files = firstChapterFiles(created.book);
    const read = () =>
      projectStore.readDocument(created.projectDirectory, {
        fileId: files.body.id
      });
    await read();
    const internal = join(created.projectDirectory, ".deepwrite");
    const before = await lstat(internal);
    const diskReads = vi.spyOn(io, "readSecureTextFile");
    await read();
    await projectStore.readDocument(created.projectDirectory, {
      fileId: files.handoff.id
    });
    const paths = diskReads.mock.calls.map(([, path]) => path);
    expect(paths).not.toContain("deepwrite.json");
    expect(paths).not.toContain(LONG_WORKSPACE_INDEX_PATH);
    expect(paths).not.toContain(files.card.path);
    expect((await lstat(internal)).mtimeMs).toBe(before.mtimeMs);
  });

  it("invalidates same-size metadata edits even when mtime is restored", async () => {
    const { projectStore, created } = await createFixture("metadata-edit");
    await projectStore.openBook(created.projectDirectory);
    const path = join(created.projectDirectory, "deepwrite.json");
    const before = await lstat(path);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const oldContent = await readFile(path, "utf8");
    manifest.title = manifest.title.replace("长篇", "新篇");
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    expect(Buffer.byteLength(content)).toBe(Buffer.byteLength(oldContent));
    await writeFile(path, content);
    await utimes(path, before.atime, before.mtime);
    expect(
      (await projectStore.openBook(created.projectDirectory)).book.title
    ).toBe(manifest.title);
  });

  it("invalidates an atomically replaced index and rejects corrupted replacements", async () => {
    const { projectStore, created } = await createFixture("index-replace");
    await projectStore.openBook(created.projectDirectory);
    const path = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const before = await lstat(path);
    const index = JSON.parse(await readFile(path, "utf8"));
    index.worldbuilding[0].title = "法则";
    await writeFile(`${path}.next`, `${JSON.stringify(index, null, 2)}\n`);
    await utimes(`${path}.next`, before.atime, before.mtime);
    await rename(`${path}.next`, path);
    expect(
      (await projectStore.openBook(created.projectDirectory)).book
        .workspaceIndex.worldbuilding[0]?.title
    ).toBe("法则");
    await writeFile(path, "{}");
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: firstChapterFiles(created.book).body.id
      })
    ).rejects.toThrow();
  });

  it("keeps returned books and failed mutations out of the cached snapshot", async () => {
    const { projectStore, created } = await createFixture("cache-isolation");
    const opened = await projectStore.openBook(created.projectDirectory);
    opened.book.workspaceIndex.plot.chapterCards[0]!.title = "仅修改返回对象";
    opened.summary.title = "仅修改摘要";
    const cached = await projectStore.openBook(created.projectDirectory);
    expect(cached.book.workspaceIndex.plot.chapterCards[0]?.title).toBe(
      created.book.workspaceIndex.plot.chapterCards[0]?.title
    );
    expect(cached.summary.title).toBe(created.summary.title);
    await expect(
      projectStore.transactManaged(created.projectDirectory, async (loaded) => {
        loaded.index.plot.chapterCards[0]!.title = "落盘前失败的修改";
        throw new Error("模拟事务失败");
      })
    ).rejects.toThrow("模拟事务失败");
    const next = await projectStore.openBook(created.projectDirectory);
    expect(next.book.workspaceIndex.plot.chapterCards[0]?.title).toBe(
      created.book.workspaceIndex.plot.chapterCards[0]?.title
    );
    expect(next.summary.title).toBe(created.summary.title);
  });

  it("sees body-only external edits and checks file safety on cached reads", async () => {
    const { projectStore, created } = await createFixture("body-cache");
    const body = firstChapterFiles(created.book).body;
    const path = join(created.projectDirectory, body.path);
    await projectStore.readDocument(created.projectDirectory, {
      fileId: body.id
    });
    await writeFile(path, "外部编辑后的正文");
    const result = await projectStore.readDocument(created.projectDirectory, {
      fileId: body.id
    });
    expect(result.content).toBe("外部编辑后的正文");
    expect(result.file).toEqual(body);
    await unlink(path);
    await symlink(join(created.projectDirectory, "deepwrite.json"), path);
    await expect(
      projectStore.readDocument(created.projectDirectory, { fileId: body.id })
    ).rejects.toThrow(/符号链接|普通文件/u);
  });

  it("recovers a pending body-only transaction before serving a warm snapshot", async () => {
    const { projectStore, created } = await createFixture("cache-recovery");
    const body = firstChapterFiles(created.book).body;
    await projectStore.readDocument(created.projectDirectory, {
      fileId: body.id
    });
    const staged = await stageRecovery(created.projectDirectory, [
      { path: body.path, content: "恢复后的正文" }
    ]);
    await expect(
      projectStore.readDocument(created.projectDirectory, { fileId: body.id })
    ).resolves.toMatchObject({ content: "恢复后的正文" });
    await expect(lstat(staged.journalPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("waits for an active transaction writer even before its journal is published", async () => {
    const { projectStore, created } = await createFixture(
      "cache-active-writer"
    );
    const body = firstChapterFiles(created.book).body;
    await projectStore.readDocument(created.projectDirectory, {
      fileId: body.id
    });
    const release = await acquireProjectTransactionLock(
      created.projectDirectory
    );
    let settled = false;
    const pending = projectStore
      .readDocument(created.projectDirectory, { fileId: body.id })
      .finally(() => {
        settled = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(settled).toBe(false);
      await writeFile(
        join(created.projectDirectory, body.path),
        "写锁内更新正文"
      );
    } finally {
      await release();
    }
    await expect(pending).resolves.toMatchObject({ content: "写锁内更新正文" });
  });

  it("does not scan a current chapter card when an unrelated document is read", async () => {
    const { projectStore, created } = await createFixture("lazy-card-check");
    const files = firstChapterFiles(created.book);
    await unlink(join(created.projectDirectory, files.card.path));
    await symlink(
      join(created.projectDirectory, "deepwrite.json"),
      join(created.projectDirectory, files.card.path)
    );
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: files.body.id
      })
    ).resolves.toMatchObject({ content: "" });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: files.card.id
      })
      // Windows opens the reparsed link and the identity guard reports a
      // replacement instead of the link kind; both reprisals are fail-safe.
    ).rejects.toThrow(/符号链接|普通文件|替换/u);
  });
});
