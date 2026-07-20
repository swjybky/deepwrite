import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("WorkspaceDirectoryStore", () => {
  it("defaults a first-time user to the system documents directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-workspace-directory-default-"));
    temporaryRoots.push(root);
    const documents = join(root, "Documents");
    const userData = join(root, "user-data");

    const store = new WorkspaceDirectoryStore(userData);
    const initialized = await store.initializeDefault(documents);
    const canonicalDocuments = await realpath(documents);
    expect(initialized).toEqual({ path: canonicalDocuments });

    const reloaded = new WorkspaceDirectoryStore(userData);
    await expect(reloaded.list()).resolves.toEqual({ path: canonicalDocuments });
  });

  it("keeps an existing workspace directory when initializing the default", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-workspace-directory-existing-"));
    temporaryRoots.push(root);
    const existing = join(root, "已有工作区");
    const documents = join(root, "Documents");
    await Promise.all([mkdir(existing), mkdir(documents)]);

    const store = new WorkspaceDirectoryStore(join(root, "user-data"));
    const canonicalExisting = await realpath(existing);
    await store.save(existing);

    await expect(store.initializeDefault(documents)).resolves.toEqual({
      path: canonicalExisting
    });
    await expect(store.list()).resolves.toEqual({ path: canonicalExisting });
  });

  it("starts unset and persists freely switchable directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-workspace-directory-"));
    temporaryRoots.push(root);
    const first = join(root, "工作区一");
    const second = join(root, "工作区二");
    await Promise.all([mkdir(first), mkdir(second)]);

    const store = new WorkspaceDirectoryStore(join(root, "user-data"));
    await expect(store.list()).resolves.toEqual({ path: null });
    const canonicalFirst = await realpath(first);
    const canonicalSecond = await realpath(second);
    await expect(store.save(first)).resolves.toEqual({ path: canonicalFirst });
    await expect(store.save(second)).resolves.toEqual({ path: canonicalSecond });

    const reloaded = new WorkspaceDirectoryStore(join(root, "user-data"));
    await expect(reloaded.list()).resolves.toEqual({ path: canonicalSecond });
  });

  it("rejects files as workspace directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-workspace-directory-file-"));
    temporaryRoots.push(root);
    const file = join(root, "not-a-folder.txt");
    await writeFile(file, "x", "utf8");

    await expect(
      new WorkspaceDirectoryStore(join(root, "user-data")).save(file)
    ).rejects.toThrow(/真实文件夹/u);
  });
});
