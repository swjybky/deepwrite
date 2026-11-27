import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireStorageInstanceLock,
  initializeStorageLocation,
  recordStorageBootstrapOwner,
  resolveStorageBootstrapLockRoot
} from "./storage-bootstrap";
import { STORAGE_BOOTSTRAP_OWNER_FILE } from "@deepwrite/shared/node";
import { StorageLocationStore } from "./storage-location-store";
import { createBootstrapEnvironment } from "./bootstrap-environment";
import { LongWorkspaceService } from "../utilities/long-workspace-service";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-storage-bootstrap-"))
  );
  roots.push(root);
  const defaultPath = join(root, "default");
  const target = join(root, "custom");
  await mkdir(defaultPath);
  await mkdir(target);
  const paths = { userData: defaultPath, sessionData: defaultPath };
  const app = {
    getPath: () => paths.userData,
    setPath: (name: "userData" | "sessionData", path: string) => {
      paths[name] = path;
    },
    requestSingleInstanceLock: vi.fn(() => true)
  };
  return { root, defaultPath, target, paths, app };
}

async function profileAlias(root: string) {
  const parent = join(root, "迁移数据");
  const alias = join(root, "storage-alias");
  const path = join(parent, "DeepWrite_data", "desktop");
  await mkdir(path, { recursive: true });
  await symlink(
    parent,
    alias,
    process.platform === "win32" ? "junction" : "dir"
  );
  return {
    canonical: await realpath(path),
    requested: join(alias, "DeepWrite_data", "desktop")
  };
}

describe("storage bootstrap", () => {
  it("keeps the instance lock outside profiles before selecting the active profile", async () => {
    const { app, paths, defaultPath } = await fixture();
    app.requestSingleInstanceLock.mockImplementation(() => {
      expect(paths.userData).toContain(".default.storage-bootstrap");
      return true;
    });
    expect(acquireStorageInstanceLock(app)).toBe(true);
    expect(paths.userData).toBe(defaultPath);
    const lockRoot = recordStorageBootstrapOwner(defaultPath, "inst-owner-1");
    expect(lockRoot).toBe(resolveStorageBootstrapLockRoot(defaultPath));
    expect(
      JSON.parse(
        await readFile(join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE), "utf8")
      )
    ).toMatchObject({
      pid: process.pid,
      instanceId: "inst-owner-1"
    });
  });

  it("uses the system default without creating a custom configuration", async () => {
    const { app, paths, defaultPath } = await fixture();
    const migrate = vi.fn();
    const { locations } = initializeStorageLocation(app, migrate);
    expect(paths).toEqual({ userData: defaultPath, sessionData: defaultPath });
    expect(locations.currentPath).toBe(defaultPath);
    expect(migrate).not.toHaveBeenCalled();
    await expect(readFile(locations.statePath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("resolves a default profile's parent alias without relocating its bootstrap anchor", async () => {
    const { root, app, paths } = await fixture();
    const { requested, canonical } = await profileAlias(root);
    paths.userData = requested;
    const original = new StorageLocationStore(requested);
    const { locations } = initializeStorageLocation(app);
    expect(paths).toEqual({ userData: canonical, sessionData: canonical });
    expect(locations.currentPath).toBe(canonical);
    expect(locations.defaultPath).toBe(requested);
    expect(locations.statePath).toBe(original.statePath);
    await expect(readFile(locations.statePath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reopens migrated data through an old alias and registers long books using the canonical profile", async () => {
    const { root, app, paths, defaultPath } = await fixture();
    const { requested, canonical } = await profileAlias(root);
    const store = new StorageLocationStore(defaultPath);
    store.schedule(requested, false);
    store.complete();
    const pointer = await readFile(store.statePath, "utf8");
    await writeFile(join(canonical, "retained.txt"), "existing profile");

    const migrate = vi.fn();
    const { locations } = initializeStorageLocation(app, migrate);
    expect(migrate).not.toHaveBeenCalled();
    expect(paths).toEqual({ userData: canonical, sessionData: canonical });
    expect(locations.currentPath).toBe(canonical);
    expect(await readFile(join(paths.userData, "retained.txt"), "utf8")).toBe(
      "existing profile"
    );
    expect(await readFile(store.statePath, "utf8")).toBe(pointer);

    const environment: NodeJS.ProcessEnv = {};
    const configure = createBootstrapEnvironment({
      environment,
      exists: () => false
    });
    const userDataPath = configure(
      { ...app, getAppPath: () => root },
      "evaluation"
    );
    expect(environment.DEEPWRITE_USER_DATA_PATH).toBe(canonical);
    const longs = new LongWorkspaceService({ userDataPath });
    const created = await longs.create(join(root, "books"), {
      title: "迁移后的长篇",
      genre: "悬疑"
    });
    const reopened = await new LongWorkspaceService({ userDataPath }).open({
      bookId: created.book.id
    });
    expect(reopened.book.title).toBe("迁移后的长篇");
    expect((await longs.list()).books.map(({ id }) => id)).toContain(
      created.book.id
    );

    locations.schedule(join(root, "next-profile"), false);
    const next = new StorageLocationStore(defaultPath);
    expect(next.currentPath).toBe(canonical);
    expect(next.pending?.sourcePath).toBe(canonical);
  });

  it("resolves the migration target before passing it to Electron and Core", async () => {
    const { root, app, paths, defaultPath } = await fixture();
    const { requested, canonical } = await profileAlias(root);
    new StorageLocationStore(defaultPath).schedule(requested, false);
    const migrate = vi.fn();
    const { locations } = initializeStorageLocation(app, migrate);
    expect(migrate).toHaveBeenCalledWith(
      expect.objectContaining({ targetPath: requested })
    );
    expect(paths).toEqual({ userData: canonical, sessionData: canonical });
    expect(locations.currentPath).toBe(canonical);
    expect(locations.pending).toBeUndefined();
  });

  it.runIf(process.platform === "win32")(
    "restores Windows drive and directory casing from an existing profile pointer",
    async () => {
      const { root, app, paths, defaultPath } = await fixture();
      const target = join(root, "MixedCaseData", "Desktop");
      await mkdir(target, { recursive: true });
      const canonical = await realpath(target);
      const requested = canonical.toLowerCase();
      const store = new StorageLocationStore(defaultPath);
      store.schedule(requested, false);
      store.complete();

      const { locations } = initializeStorageLocation(app);
      expect(requested).not.toBe(canonical);
      expect(paths).toEqual({ userData: canonical, sessionData: canonical });
      expect(locations.currentPath).toBe(canonical);
    }
  );

  it("commits migration before pointing both Electron profiles at the new data", async () => {
    const { app, paths, defaultPath, target } = await fixture();
    new StorageLocationStore(defaultPath).schedule(target, false);
    const migrate = vi.fn(() => expect(paths.userData).toBe(defaultPath));
    const result = initializeStorageLocation(app, migrate);
    expect(migrate).toHaveBeenCalledOnce();
    expect(paths).toEqual({ userData: target, sessionData: target });
    expect(result.locations.pending).toBeUndefined();
    expect(new StorageLocationStore(defaultPath).currentPath).toBe(target);
    expect(
      JSON.parse(await readFile(result.locations.statePath, "utf8"))
    ).toEqual({ version: 1, currentPath: target });
  });

  it("retains the original profile and clears the plan after migration failure", async () => {
    const { app, paths, defaultPath, target } = await fixture();
    new StorageLocationStore(defaultPath).schedule(target, false);
    const result = initializeStorageLocation(app, () => {
      throw new Error("ENOSPC");
    });
    expect(result.migrationError).toContain("原有数据未删除");
    expect(paths.userData).toBe(defaultPath);
    expect(new StorageLocationStore(defaultPath).pending).toBeUndefined();
  });

  it("refuses unavailable custom data instead of creating an empty profile", async () => {
    const { app, defaultPath, target } = await fixture();
    const store = new StorageLocationStore(defaultPath);
    store.schedule(target, false);
    store.complete();
    await rm(target, { recursive: true });
    expect(() => initializeStorageLocation(app)).toThrow("用户数据目录不可用");
    expect(new StorageLocationStore(defaultPath).currentPath).toBe(target);
  });

  it("does not silently discard malformed bootstrap pointers", async () => {
    const { app, defaultPath } = await fixture();
    const store = new StorageLocationStore(defaultPath);
    await writeFile(store.statePath, '{"version":1,"currentPath":"relative"}');
    expect(() => initializeStorageLocation(app)).toThrow(
      "存储位置配置无法读取"
    );
  });
});
