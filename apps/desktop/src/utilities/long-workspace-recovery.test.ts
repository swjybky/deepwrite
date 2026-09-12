import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEnvelope, CommandEnvelopeSchema } from "@deepwrite/contracts";
import { LongWorkspaceService } from "./long-workspace-service";
import { handleLongCoreCommand } from "./long-core-commands";
import { stageRecovery } from "./project-recovery.test-support";
import { resolveLongWorkspaceConflicts } from "./long-workspace-recovery";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(async (root) => await rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-conflict-"))
  );
  roots.push(root);
  const parent = join(root, "books");
  await mkdir(parent);
  const userDataPath = join(root, "data");
  const service = new LongWorkspaceService({ userDataPath });
  const created = await service.create(parent, {
    title: "冲突恢复测试",
    genre: "悬疑"
  });
  const bookId = created.book.id;
  const { projectDirectory } = await service.catalog.open(bookId);
  const index = await readFile(
    join(projectDirectory, "long/index.json"),
    "utf8"
  );
  const manifest = await readFile(
    join(projectDirectory, "deepwrite.json"),
    "utf8"
  );
  const stamp = "2026-09-11T12:00:00.000Z";
  const stagedIndex = JSON.stringify({
    ...JSON.parse(index),
    updatedAt: stamp
  });
  const m = JSON.parse(manifest);
  const stagedManifest = JSON.stringify({
    ...m,
    updatedAt: stamp,
    workspaceIndexFile: { ...m.workspaceIndexFile, updatedAt: stamp }
  });
  return {
    root,
    service,
    userDataPath,
    bookId,
    projectDirectory,
    index,
    manifest,
    stagedIndex,
    stagedManifest
  };
}

describe("long project conflict resolution", () => {
  it.each(["long/index.json", "deepwrite.json"])(
    "accepts UTF-8 BOM and CRLF from a Windows editor in %s and stays readable after restart",
    async (path) => {
      const f = await fixture();
      const { journalPath } = await stageRecovery(f.projectDirectory, [
        { path: "long/index.json", content: f.stagedIndex },
        { path: "deepwrite.json", content: f.stagedManifest }
      ]);
      const original = path === "long/index.json" ? f.index : f.manifest;
      const edited = `\uFEFF${original.replace(/\n/g, "\r\n")}`;
      await writeFile(join(f.projectDirectory, path), edited);
      await expect(f.service.open({ bookId: f.bookId })).rejects.toThrow(
        "项目文件已在其他位置更新"
      );
      const result = await resolveLongWorkspaceConflicts(f.service, {
        bookId: f.bookId
      });
      expect(result.resolvedPaths).toContain(path);
      if (path === "long/index.json") {
        expect(await readFile(join(f.projectDirectory, path), "utf8")).toBe(
          edited
        );
      }
      expect(
        await readFile(
          join(f.projectDirectory, result.backupPath!, "current", path),
          "utf8"
        )
      ).toBe(edited);
      await expect(readFile(journalPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
      const restarted = new LongWorkspaceService({
        userDataPath: f.userDataPath
      });
      expect((await restarted.catalog.list()).diagnostics ?? []).toEqual([]);
      await expect(restarted.open({ bookId: f.bookId })).resolves.toMatchObject(
        {
          book: { id: f.bookId }
        }
      );
      await expect(
        restarted.renameBook({
          bookId: f.bookId,
          title: "Windows 编辑后继续保存"
        })
      ).resolves.toMatchObject({ book: { title: "Windows 编辑后继续保存" } });
    }
  );

  it("recovers supported legacy revision metadata before the normal migration can run", async () => {
    const f = await fixture();
    const index = { ...JSON.parse(f.index), revision: 7 };
    index.bookLine.revision = "v1:legacy";
    const manifest = { ...JSON.parse(f.manifest), revision: 7 };
    manifest.workspaceIndexFile.revision = "v1:legacy";
    await writeFile(
      join(f.projectDirectory, "long/index.json"),
      JSON.stringify(index)
    );
    await writeFile(
      join(f.projectDirectory, "deepwrite.json"),
      JSON.stringify(manifest)
    );
    const { journalPath } = await stageRecovery(f.projectDirectory, [
      { path: "long/index.json", content: f.stagedIndex },
      { path: "deepwrite.json", content: f.stagedManifest }
    ]);
    const edited = JSON.stringify({ ...manifest, title: "保留手动修改的书名" });
    await writeFile(join(f.projectDirectory, "deepwrite.json"), edited);
    await writeFile(
      join(f.projectDirectory, "long/index.json"),
      `${JSON.stringify(index)}\n`
    );
    const result = await resolveLongWorkspaceConflicts(f.service, {
      bookId: f.bookId
    });
    expect(result.book.title).toBe("保留手动修改的书名");
    expect(
      await readFile(
        join(f.projectDirectory, result.backupPath!, "current/deepwrite.json"),
        "utf8"
      )
    ).toBe(edited);
    await expect(readFile(journalPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    const restarted = new LongWorkspaceService({
      userDataPath: f.userDataPath
    });
    expect((await restarted.catalog.list()).diagnostics ?? []).toEqual([]);
    await expect(
      restarted.renameBook({ bookId: f.bookId, title: "恢复后保存" })
    ).resolves.toMatchObject({ book: { title: "恢复后保存" } });
  });

  it.each(["prepared", "committing"] as const)(
    "keeps external index edits, backs up recovery, and permits subsequent writes after %s recovery",
    async (phase) => {
      const f = await fixture();
      const { journalPath } = await stageRecovery(
        f.projectDirectory,
        [
          { path: "long/index.json", content: f.stagedIndex },
          { path: "deepwrite.json", content: f.stagedManifest }
        ],
        phase
      );
      const originalJournal = await readFile(journalPath, "utf8");
      // Whitespace-only manual edits also change SHA-256 and must be retained.
      const editedIndex = `${f.index}\n  `;
      await writeFile(join(f.projectDirectory, "long/index.json"), editedIndex);
      // A restarted Core still cannot open until the explicit recovery command.
      const restarted = new LongWorkspaceService({
        userDataPath: f.userDataPath
      });
      await expect(restarted.open({ bookId: f.bookId })).rejects.toThrow(
        "项目文件已在其他位置更新"
      );
      const command = createEnvelope(
        "long.resolveConflicts",
        { bookId: f.bookId },
        { id: "resolve-test" }
      );
      expect(CommandEnvelopeSchema.parse(command).type).toBe(
        "long.resolveConflicts"
      );
      const result = await handleLongCoreCommand(restarted, command);
      expect(result?.status).toBe("accepted");
      if (result?.status !== "accepted")
        throw new Error("Expected accepted recovery");
      const payload = result.payload as Awaited<
        ReturnType<typeof resolveLongWorkspaceConflicts>
      >;
      expect(payload.resolvedPaths).toEqual(["long/index.json"]);
      expect(payload.book.updatedAt).toBe(
        payload.book.workspaceIndex.updatedAt
      );
      expect(
        await readFile(join(f.projectDirectory, "long/index.json"), "utf8")
      ).toBe(editedIndex);
      const backup = join(f.projectDirectory, payload.backupPath!);
      expect(await readFile(join(backup, "transaction.json"), "utf8")).toBe(
        originalJournal
      );
      expect(
        await readFile(join(backup, "current/long/index.json"), "utf8")
      ).toBe(editedIndex);
      expect(await readFile(join(backup, "stage/0"), "utf8")).toBe(
        f.stagedIndex
      );
      expect(await readFile(join(backup, "backup/0"), "utf8")).toBe(f.index);
      await expect(readFile(journalPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(
        restarted.renameBook({ bookId: f.bookId, title: "恢复后可保存" })
      ).resolves.toMatchObject({ book: { title: "恢复后可保存" } });
      await expect(
        resolveLongWorkspaceConflicts(restarted, { bookId: f.bookId })
      ).resolves.toMatchObject({ resolvedPaths: [], backupPath: null });
    }
  );

  it("refuses invalid JSON without replacing the journal or any project files", async () => {
    const f = await fixture();
    const { journalPath } = await stageRecovery(f.projectDirectory, [
      { path: "long/index.json", content: f.stagedIndex }
    ]);
    const original = await readFile(journalPath, "utf8");
    await writeFile(join(f.projectDirectory, "long/index.json"), "{ invalid");
    await expect(
      resolveLongWorkspaceConflicts(f.service, { bookId: f.bookId })
    ).rejects.toThrow("不是有效 JSON");
    expect(await readFile(journalPath, "utf8")).toBe(original);
    expect(
      await readFile(join(f.projectDirectory, "deepwrite.json"), "utf8")
    ).toBe(f.manifest);
  });

  it("rejects malformed UTF-8 without replacing it with silently decoded text", async () => {
    const f = await fixture();
    const { journalPath } = await stageRecovery(f.projectDirectory, [
      { path: "long/index.json", content: f.stagedIndex }
    ]);
    const originalJournal = await readFile(journalPath);
    const edited = Buffer.concat([
      Buffer.from(f.index.replace(/}\s*$/, ', "revision": "')),
      Buffer.from([0xff]),
      Buffer.from('"}')
    ]);
    const indexPath = join(f.projectDirectory, "long/index.json");
    await writeFile(indexPath, edited);
    await expect(
      resolveLongWorkspaceConflicts(f.service, { bookId: f.bookId })
    ).rejects.toThrow("不是有效 UTF-8");
    expect(await readFile(indexPath)).toEqual(edited);
    expect(await readFile(journalPath)).toEqual(originalJournal);
  });

  it.each([false, true])(
    "preserves a document still referenced by the external index when deletion was applied: %s",
    async (applied) => {
      const f = await fixture();
      const index = JSON.parse(f.index);
      const path = index.bookLine.path as string;
      await writeFile(join(f.projectDirectory, path), "必须保留的书籍主线");
      await stageRecovery(
        f.projectDirectory,
        [
          { path: "long/index.json", content: f.stagedIndex },
          { path, content: null }
        ],
        "committing"
      );
      if (applied) await rm(join(f.projectDirectory, path));
      await writeFile(
        join(f.projectDirectory, "long/index.json"),
        `${f.index}\n`
      );
      await expect(
        resolveLongWorkspaceConflicts(f.service, { bookId: f.bookId })
      ).resolves.toMatchObject({ resolvedPaths: ["long/index.json"] });
      expect(await readFile(join(f.projectDirectory, path), "utf8")).toBe(
        "必须保留的书籍主线"
      );
      await expect(
        f.service.readDocument({
          bookId: f.bookId,
          fileId: index.bookLine.id,
          offset: 0,
          maxCharacters: 1000
        })
      ).resolves.toMatchObject({ content: "必须保留的书籍主线" });
    }
  );

  it("rejects an unregistered book and arbitrary renderer paths", async () => {
    const f = await fixture();
    await expect(
      resolveLongWorkspaceConflicts(f.service, { bookId: "longbook_missing" })
    ).rejects.toThrow("未注册");
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "long.resolveConflicts",
          { bookId: f.bookId, projectDirectory: f.root } as never,
          { id: "invalid-path" }
        )
      ).success
    ).toBe(false);
  });
});
