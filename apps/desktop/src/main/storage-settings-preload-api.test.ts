import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageDirectoryKind } from "@deepwrite/contracts";

vi.mock("../preload/invoke", () => ({
  browserId: (prefix: string) => `${prefix}_test`,
  invokeCommand: vi.fn()
}));

import { invokeCommand } from "../preload/invoke";
import { storageSettings } from "../preload/storage-settings-api";

const mockedInvokeCommand = vi.mocked(invokeCommand);

describe("storage settings preload API", () => {
  beforeEach(() => mockedInvokeCommand.mockReset());

  it("returns current and default paths through the dedicated command", async () => {
    const snapshot = {
      userData: {
        path: "/storage/custom",
        defaultPath: "/storage/default",
        isDefault: false
      },
      workspace: {
        path: "/workspace/default",
        defaultPath: "/workspace/default",
        isDefault: true
      }
    };
    mockedInvokeCommand.mockResolvedValue(snapshot);
    await expect(storageSettings.get()).resolves.toEqual(snapshot);
    expect(mockedInvokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "storageSettings.get", payload: {} })
    );
    mockedInvokeCommand.mockResolvedValue({ userData: snapshot.userData });
    await expect(storageSettings.get()).rejects.toThrow();
  });

  it("preserves cancellation and restart outcomes and validates all change replies", async () => {
    mockedInvokeCommand
      .mockResolvedValueOnce({ restarting: false })
      .mockResolvedValueOnce({ restarting: true })
      .mockResolvedValueOnce({ path: "/workspace/default" });
    await expect(storageSettings.chooseUserData()).resolves.toEqual({
      restarting: false
    });
    await expect(storageSettings.resetUserData()).resolves.toEqual({
      restarting: true
    });
    await expect(storageSettings.resetWorkspaceDirectory()).resolves.toEqual({
      path: "/workspace/default"
    });
    expect(
      mockedInvokeCommand.mock.calls.map(([command]) => command.type)
    ).toEqual([
      "storageSettings.chooseUserData",
      "storageSettings.resetUserData",
      "storageSettings.resetWorkspaceDirectory"
    ]);
    mockedInvokeCommand.mockResolvedValue({});
    await expect(storageSettings.chooseUserData()).rejects.toThrow();
    await expect(storageSettings.resetUserData()).rejects.toThrow();
    await expect(storageSettings.resetWorkspaceDirectory()).rejects.toThrow();
  });

  it("rejects arbitrary paths before IPC and invalid open acknowledgments", async () => {
    await expect(
      storageSettings.openDirectory("/arbitrary/path" as StorageDirectoryKind)
    ).rejects.toThrow();
    expect(mockedInvokeCommand).not.toHaveBeenCalled();

    mockedInvokeCommand.mockResolvedValue({ opened: true });
    await expect(
      storageSettings.openDirectory("workspace")
    ).resolves.toBeUndefined();
    expect(mockedInvokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "storageSettings.openDirectory",
        payload: { kind: "workspace" }
      })
    );
    mockedInvokeCommand.mockResolvedValue({ opened: false });
    await expect(storageSettings.openDirectory("user-data")).rejects.toThrow();
  });

  it("validates compaction and backup release replies", async () => {
    const compacted = {
      phase: "completed_with_backup" as const,
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      processedSessions: 2,
      totalSessions: 2,
      bytesBefore: 1000,
      bytesAfter: 200,
      backupBytes: 1000,
      netFreedBytes: -200,
      canRetry: false,
      canReleaseBackup: true,
      canRollback: true
    };
    mockedInvokeCommand.mockResolvedValueOnce(compacted).mockResolvedValueOnce({
      ...compacted,
      phase: "backup_released",
      backupBytes: 0,
      canReleaseBackup: false,
      canRollback: false
    });

    await expect(storageSettings.compactConversations()).resolves.toEqual(
      compacted
    );
    await expect(
      storageSettings.releaseConversationBackup()
    ).resolves.toMatchObject({
      phase: "backup_released",
      canReleaseBackup: false
    });
    expect(mockedInvokeCommand.mock.calls.map(([c]) => c.type)).toEqual([
      "storageSettings.compactConversations",
      "storageSettings.releaseConversationBackup"
    ]);
  });
});
