import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import { handleStorageSettingsCommands } from "./ipc/storage-settings-commands";
import {
  StorageSettingsService,
  USER_DATA_FOLDER_NAME
} from "./storage-settings-service";
import { StorageLocationStore } from "./storage-location-store";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-storage-settings-"))
  );
  roots.push(root);
  const source = join(root, "default");
  const target = join(root, "target");
  const documents = join(root, "documents");
  const installation = join(root, "application");
  await Promise.all([
    mkdir(source),
    mkdir(target),
    mkdir(documents),
    mkdir(installation)
  ]);
  const locations = new StorageLocationStore(source);
  const workspace = new WorkspaceDirectoryStore(source);
  await workspace.initializeDefault(documents);
  const options = {
    locations,
    workspace: () => workspace,
    documentsPath: () => documents,
    installationDirectory: () => installation,
    chooseDirectory: vi.fn(async (): Promise<string | undefined> => target),
    confirmMigration: vi.fn(async () => true),
    openPath: vi.fn(async () => ""),
    busy: vi.fn(() => false),
    flushRenderer: vi.fn(async () => undefined),
    restart: vi.fn()
  };
  const service = new StorageSettingsService(options);
  return {
    root,
    source,
    target,
    documents,
    installation,
    workspace,
    options,
    service
  };
}

describe("storage settings service", () => {
  it("reports actual and default paths and opens only the requested configured directory", async () => {
    const { service, source, documents, options } = await fixture();
    const snapshot = await service.get();
    expect(snapshot.userData).toEqual({
      path: source,
      defaultPath: source,
      isDefault: true
    });
    expect(snapshot.workspace.path).toBe(join(documents, "DeepWriteBooks"));
    await service.openDirectory("workspace");
    expect(options.openPath).toHaveBeenCalledWith(snapshot.workspace.path);
  });

  it("resets the shared workspace setting without moving or deleting existing books", async () => {
    const { service, workspace, target, documents } = await fixture();
    await workspace.save(target);
    await writeFile(join(target, "book.md"), "existing manuscript");
    expect((await service.get()).workspace.isDefault).toBe(false);
    expect(await service.resetWorkspaceDirectory()).toEqual({
      path: join(documents, "DeepWriteBooks")
    });
    expect((await workspace.list()).path).toBe(
      join(documents, "DeepWriteBooks")
    );
    expect(await readFile(join(target, "book.md"), "utf8")).toBe(
      "existing manuscript"
    );
  });

  it("flushes saved data before scheduling migration, keeping the active location until restart", async () => {
    const { service, source, target, options } = await fixture();
    options.flushRenderer.mockImplementation(async () => {
      expect(options.locations.pending).toBeUndefined();
    });
    expect(await service.chooseUserData()).toEqual({ restarting: true });
    expect(options.confirmMigration).toHaveBeenCalledWith(
      source,
      target,
      false,
      false
    );
    expect(options.locations.currentPath).toBe(source);
    expect(options.locations.pending).toMatchObject({
      sourcePath: source,
      targetPath: target
    });
    expect(options.restart).toHaveBeenCalledOnce();
    await expect(service.chooseUserData()).rejects.toThrow("等待");
    service.cancelRestart();
    expect(options.locations.pending).toBeUndefined();
    expect(service.restartPending).toBe(false);
  });

  it("does not schedule a migration when saving fails or the user cancels", async () => {
    const { service, options } = await fixture();
    options.confirmMigration.mockResolvedValueOnce(false);
    expect(await service.chooseUserData()).toEqual({ restarting: false });
    options.flushRenderer.mockRejectedValueOnce(new Error("save failed"));
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.save_failed",
      message: expect.stringContaining("save failed")
    });
    expect(options.locations.pending).toBeUndefined();
    expect(options.restart).not.toHaveBeenCalled();
  });

  it("moves into a new subfolder when the chosen folder already has files", async () => {
    const { service, source, target, options } = await fixture();
    await writeFile(join(target, "keep.txt"), "existing data");
    const subfolder = join(target, USER_DATA_FOLDER_NAME);
    expect(await service.chooseUserData()).toEqual({ restarting: true });
    expect(options.confirmMigration).toHaveBeenCalledWith(
      source,
      subfolder,
      false,
      true
    );
    expect(options.locations.pending).toMatchObject({
      targetPath: subfolder,
      allowExistingTarget: false
    });
    // The offline migration creates the folder; existing files stay untouched.
    expect(await readdir(target)).toEqual(["keep.txt"]);
  });

  it("reuses an empty subfolder but never fills an occupied one", async () => {
    const { service, target, options } = await fixture();
    await writeFile(join(target, "keep.txt"), "existing data");
    const subfolder = join(target, USER_DATA_FOLDER_NAME);
    await mkdir(subfolder);
    await writeFile(join(subfolder, "notes.md"), "other data");
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.target_not_empty"
    });
    expect(options.confirmMigration).not.toHaveBeenCalled();
    await rm(join(subfolder, "notes.md"));
    expect(await service.chooseUserData()).toEqual({ restarting: true });
    expect(options.locations.pending?.targetPath).toBe(subfolder);
  });

  it("rejects links, nested paths, and running agents with stable codes", async () => {
    const { root, service, source, target, options } = await fixture();
    const link = join(root, "link");
    await symlink(target, link, "dir");
    options.chooseDirectory.mockResolvedValueOnce(link);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.invalid_directory"
    });
    const nested = join(source, "nested");
    await mkdir(nested);
    options.chooseDirectory.mockResolvedValueOnce(nested);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.nested_location"
    });
    options.busy.mockReturnValueOnce(true);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.busy"
    });
    options.busy.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.busy"
    });
    expect(options.flushRenderer).not.toHaveBeenCalled();
    expect(options.locations.pending).toBeUndefined();
    expect(options.restart).not.toHaveBeenCalled();
  });

  it("rejects the installation directory and its descendants before migration", async () => {
    const { service, installation, options } = await fixture();
    options.chooseDirectory.mockResolvedValueOnce(installation);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.overlaps_installation"
    });
    await writeFile(join(installation, "DeepWrite.exe"), "binary");
    options.chooseDirectory.mockResolvedValueOnce(installation);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.overlaps_installation"
    });
    const nested = join(installation, "data");
    await mkdir(nested);
    options.chooseDirectory.mockResolvedValueOnce(nested);
    await expect(service.chooseUserData()).rejects.toMatchObject({
      code: "storage_settings.overlaps_installation"
    });
    expect(options.confirmMigration).not.toHaveBeenCalled();
    expect(options.locations.pending).toBeUndefined();
  });

  it("uses a separate subfolder when the chosen parent holds the installation", async () => {
    const { root, service, options } = await fixture();
    options.chooseDirectory.mockResolvedValueOnce(root);
    expect(await service.chooseUserData()).toEqual({ restarting: true });
    expect(options.locations.pending?.targetPath).toBe(
      join(root, USER_DATA_FOLDER_NAME)
    );
  });

  it("returns stable error codes over IPC with the local diagnostic", async () => {
    const { service, installation, options } = await fixture();
    options.chooseDirectory.mockResolvedValueOnce(installation);
    const command = createEnvelope(
      "storageSettings.chooseUserData",
      {},
      { id: "cmd_storage_test", correlationId: "cmd_storage_test" }
    );
    expect(await handleStorageSettingsCommands(command, service)).toMatchObject(
      {
        status: "rejected",
        requestId: "cmd_storage_test",
        error: {
          code: "storage_settings.overlaps_installation",
          message: expect.stringContaining("安装目录")
        }
      }
    );
    options.chooseDirectory.mockRejectedValueOnce(new Error("dialog failed"));
    expect(await handleStorageSettingsCommands(command, service)).toMatchObject(
      {
        status: "rejected",
        error: {
          code: "storage_settings.operation_failed",
          message: "dialog failed"
        }
      }
    );
    options.openPath.mockResolvedValueOnce("access denied");
    await expect(service.openDirectory("user-data")).rejects.toMatchObject({
      code: "storage_settings.open_failed"
    });
  });

  it("clears the migration intent when restart dispatch fails", async () => {
    const { service, options } = await fixture();
    options.restart.mockImplementation(() => {
      throw new Error("restart failed");
    });
    await expect(service.chooseUserData()).rejects.toThrow("restart failed");
    expect(options.locations.pending).toBeUndefined();
    expect(service.restartPending).toBe(false);
  });

  it("allows restoring an occupied default only with the backup confirmation", async () => {
    const { service, source, target, options } = await fixture();
    options.locations.schedule(target, false);
    options.locations.complete();
    await writeFile(join(source, "keep.txt"), "old default data");
    expect(await service.resetUserData()).toEqual({ restarting: true });
    expect(options.confirmMigration).toHaveBeenCalledWith(
      target,
      source,
      true,
      false
    );
    expect(options.locations.pending?.allowExistingTarget).toBe(true);
    expect(await readFile(join(source, "keep.txt"), "utf8")).toBe(
      "old default data"
    );
  });

  it("includes compaction status in snapshot and routes compact/release commands", async () => {
    const statusBefore = {
      phase: "needed" as const,
      legacyCallsFound: 12,
      estimatedReclaimableBytes: 40_000_000,
      processedSessions: 0,
      totalSessions: 4,
      bytesBefore: 50_000_000,
      canRetry: true,
      canReleaseBackup: false,
      canRollback: false
    };
    const compacted = {
      ...statusBefore,
      phase: "completed_with_backup" as const,
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      processedSessions: 4,
      bytesAfter: 1_500_000,
      backupBytes: 50_000_000,
      netFreedBytes: -1_500_000,
      canRetry: false,
      canReleaseBackup: true,
      canRollback: true
    };
    const released = {
      ...compacted,
      phase: "backup_released" as const,
      backupBytes: 0,
      netFreedBytes: 48_500_000,
      canReleaseBackup: false,
      canRollback: false
    };
    const { service, options } = await fixture();
    const compact = vi.fn(async () => compacted);
    const releaseBackup = vi.fn(async () => released);
    const serviceWithCompaction = new StorageSettingsService({
      ...options,
      compaction: {
        status: vi.fn(async () => statusBefore),
        compact,
        releaseBackup
      }
    });

    const getRes = await handleStorageSettingsCommands(
      createEnvelope(
        "storageSettings.get",
        {},
        { id: "c1", correlationId: "c1" }
      ),
      serviceWithCompaction
    );
    expect(getRes).toMatchObject({
      status: "accepted",
      payload: { conversationCompaction: statusBefore }
    });

    const compactRes = await handleStorageSettingsCommands(
      createEnvelope(
        "storageSettings.compactConversations",
        {},
        { id: "c2", correlationId: "c2" }
      ),
      serviceWithCompaction
    );
    expect(compactRes).toMatchObject({
      status: "accepted",
      payload: compacted
    });

    const releaseRes = await handleStorageSettingsCommands(
      createEnvelope(
        "storageSettings.releaseConversationBackup",
        {},
        { id: "c3", correlationId: "c3" }
      ),
      serviceWithCompaction
    );
    expect(releaseRes).toMatchObject({
      status: "accepted",
      payload: released
    });
    expect(service).toBeDefined();
  });
});
