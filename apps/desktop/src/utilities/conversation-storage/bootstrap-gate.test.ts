import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveStorageBootstrapLockRoot,
  STORAGE_BOOTSTRAP_OWNER_FILE
} from "@deepwrite/shared/node";
import { ConversationDatabase } from "./database";
import { JsonNodes, type ValueRef } from "./json-nodes";
import {
  recoverCompactionOnStartup,
  releaseCompactionBackup,
  runConversationCompaction,
  type CompactionDatabaseHandle
} from "./legacy-snapshot-compaction";
import { openConversationDatabase, Statements } from "./schema";
import {
  StorageBootstrapGateError,
  withStorageBootstrapGate
} from "./bootstrap-gate";

const WINDOWS_EXLOCK_FLAG = 0x10000000;
const tempRoots: string[] = [];
const readonlyDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    readonlyDirs
      .splice(0)
      .map((dir) => chmod(dir, 0o755).catch(() => undefined))
  );
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function makeTempRoot(prefix = "dw-bs-gate-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function seedLegacyDb(databasePath: string): {
  scopeKey: string;
  sessionId: string;
} {
  const db = openConversationDatabase(databasePath);
  try {
    const sql = new Statements(db);
    const nodes = new JsonNodes(sql);
    const scopeKey = "conversation-history:win-gate-test";
    const sessionId = "sess-win-1";

    sql
      .get(
        "INSERT INTO scopes(key, active_session_id, metadata_ref, removed, epoch, incremental) VALUES (?, ?, NULL, 0, 0, 1)"
      )
      .run(scopeKey, sessionId);
    sql
      .get(
        "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position, message_count, message_bytes, turn_count) VALUES (?, ?, 1, 0, 1, 0, NULL, '2026-11-26T00:00:00.000Z', 0, 0, 0, 0)"
      )
      .run(scopeKey, sessionId);

    const insertRaw = (val: unknown): ValueRef => {
      if (val === null || typeof val !== "object") {
        if (typeof val === "string" && val.length >= 4096) {
          return nodes.create(val);
        }
        const enc = JSON.stringify(val);
        return {
          value: val as string | number | boolean | null,
          bytes: Buffer.byteLength(enc),
          chars: enc.length
        };
      }
      const id = Number(
        sql.get("INSERT INTO nodes(kind) VALUES ('pending')").run()
          .lastInsertRowid
      );
      if (Array.isArray(val)) {
        const entries = val.map((item) => insertRaw(item));
        sql
          .get("UPDATE nodes SET kind = 'array', value = ? WHERE id = ?")
          .run(JSON.stringify({ kind: "array", entries }), id);
        return {
          node: id,
          bytes: 2 + entries.reduce((a, e) => a + e.bytes + 1, 0),
          chars: 2 + entries.reduce((a, e) => a + e.chars + 1, 0)
        };
      }
      const entries: [string, ValueRef][] = Object.entries(val).map(
        ([k, v]) => [k, insertRaw(v)]
      );
      sql
        .get("UPDATE nodes SET kind = 'object', value = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "object", entries }), id);
      return {
        node: id,
        bytes: entries.reduce(
          (a, [k, v]) => a + Buffer.byteLength(JSON.stringify(k)) + 2 + v.bytes,
          2
        ),
        chars: entries.reduce(
          (a, [k, v]) => a + JSON.stringify(k).length + 2 + v.chars,
          2
        )
      };
    };

    const bigText = "Windows门闩测试文本".repeat(6000);
    const ref = insertRaw({
      id: "msg-win-1",
      role: "assistant",
      content: "旧版消息",
      subagentRuns: [
        {
          subagentRunId: "sr-win-1",
          subagentId: "reviewer",
          name: "审校",
          status: "completed",
          modelCalls: [
            {
              requestId: "req-win-1",
              sequence: 1,
              status: "completed",
              snapshot: {
                systemPrompt: bigText,
                providerInput: { system: bigText }
              }
            }
          ]
        }
      ]
    });
    sql
      .get(
        "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, 'msg-win-1', 0, ?, ?, 'assistant', '旧版消息', 0, 0, 0)"
      )
      .run(scopeKey, sessionId, JSON.stringify(ref), ref.bytes);
    return { scopeKey, sessionId };
  } finally {
    db.close();
  }
}

function makeHandle(
  databasePath: string,
  initialDb: ConversationDatabase,
  instanceId: string
): CompactionDatabaseHandle & { current(): ConversationDatabase } {
  let db = initialDb;
  return {
    current: () => db,
    getDatabase: () => db,
    closeDatabase: () => db.close(),
    reopenDatabase: () => {
      db = new ConversationDatabase(databasePath);
      db.claimMainInstance(instanceId);
      return db;
    },
    setWriteBlocked: () => undefined
  };
}

function createWinFileShareReadMockOpen(
  lockFilePath: string,
  mode: "held-share-read" | "deleted" | "unheld-stale"
): typeof open {
  return (async (path, flags, fileMode) => {
    if (String(path) === lockFilePath) {
      const numericFlags = typeof flags === "number" ? flags : 0;
      const requestsWrite =
        (numericFlags &
          (constants.O_WRONLY | constants.O_RDWR | WINDOWS_EXLOCK_FLAG)) !==
        0;
      if (mode === "held-share-read") {
        // Chromium ProcessSingleton opens Windows `lockfile` with GENERIC_WRITE + FILE_SHARE_READ:
        // O_RDONLY succeeds while any write/exclusive open fails with EBUSY.
        if (!requestsWrite) {
          return {
            close: async () => undefined
          } as Awaited<ReturnType<typeof open>>;
        }
        throw Object.assign(new Error("EBUSY: resource busy or locked, open"), {
          code: "EBUSY"
        });
      }
      if (mode === "deleted" && numericFlags === constants.O_WRONLY) {
        throw Object.assign(
          new Error("ENOENT: no such file or directory, open"),
          { code: "ENOENT" }
        );
      }
    }
    return open(path, flags, fileMode);
  }) as typeof open;
}

describe("bootstrap-gate Windows Chromium FILE_SHARE_READ & relocated tolerances", () => {
  it("recognizes current main process Chromium lockfile (FILE_SHARE_READ) for recovery, windows-rename compaction, and backup release", async () => {
    const root = await makeTempRoot("dw-win-held-");
    const defaultProfile = join(root, "DeepWrite");
    const dbPath = join(
      defaultProfile,
      "renderer-state",
      "conversations.sqlite"
    );
    await mkdir(join(defaultProfile, "renderer-state"), { recursive: true });
    const { scopeKey, sessionId } = seedLegacyDb(dbPath);

    const lockRoot = resolveStorageBootstrapLockRoot(defaultProfile);
    await mkdir(lockRoot, { recursive: true });
    const lockFilePath = join(lockRoot, "lockfile");
    await writeFile(lockFilePath, "");
    await writeFile(
      join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE),
      JSON.stringify({
        pid: process.pid,
        instanceId: "win-main-1",
        acquiredAt: new Date().toISOString()
      })
    );
    await writeFile(`${dbPath}.candidate-orphan.tmp`, "orphan");

    const mockOpen = createWinFileShareReadMockOpen(
      lockFilePath,
      "held-share-read"
    );

    await recoverCompactionOnStartup(dbPath, {
      platform: "win32",
      bootstrapLockRoot: lockRoot,
      bootstrapOwnerPid: process.pid,
      mainInstanceId: "win-main-1",
      fsOps: { open: mockOpen }
    });
    const entriesAfterRecover = await readdir(
      join(defaultProfile, "renderer-state")
    );
    expect(entriesAfterRecover.some((e) => e.includes(".candidate-"))).toBe(
      false
    );

    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("win-main-1");
    const handle = makeHandle(dbPath, db, "win-main-1");

    const compacted = await runConversationCompaction(handle, {
      platform: "win32",
      swapStrategy: "windows-rename",
      bootstrapLockRoot: lockRoot,
      bootstrapOwnerPid: process.pid,
      mainInstanceId: "win-main-1",
      minDiskHeadroomBytes: 1024,
      fsOps: { open: mockOpen }
    });
    expect(compacted.phase).toBe("completed_with_backup");
    expect(compacted.legacyCallsFound).toBe(0);

    const released = await releaseCompactionBackup(handle, {
      platform: "win32",
      bootstrapLockRoot: lockRoot,
      bootstrapOwnerPid: process.pid,
      mainInstanceId: "win-main-1",
      fsOps: { open: mockOpen }
    });
    expect(released.phase).toBe("backup_released");
    expect(
      handle.current().messages({ key: scopeKey, sessionId, limit: 10 })
        .messages
    ).toHaveLength(1);
    handle.current().close();
  });

  it("rejects with old_process_active on Windows when FILE_SHARE_READ lockfile is held by another instance or missing owner metadata", async () => {
    const root = await makeTempRoot("dw-win-other-");
    const defaultProfile = join(root, "DeepWrite");
    const dbPath = join(
      defaultProfile,
      "renderer-state",
      "conversations.sqlite"
    );
    await mkdir(join(defaultProfile, "renderer-state"), { recursive: true });
    const lockRoot = resolveStorageBootstrapLockRoot(defaultProfile);
    await mkdir(lockRoot, { recursive: true });
    const lockFilePath = join(lockRoot, "lockfile");
    await writeFile(lockFilePath, "");

    const mockOpen = createWinFileShareReadMockOpen(
      lockFilePath,
      "held-share-read"
    );

    // Case A: owner belongs to another live PID
    await writeFile(
      join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE),
      JSON.stringify({
        pid: process.ppid,
        instanceId: "other-main-instance",
        acquiredAt: new Date().toISOString()
      })
    );
    await expect(
      withStorageBootstrapGate(
        dbPath,
        {
          platform: "win32",
          bootstrapLockRoot: lockRoot,
          bootstrapOwnerPid: process.pid,
          mainInstanceId: "my-main-instance",
          fsOps: { open: mockOpen }
        },
        async () => "should-not-run"
      )
    ).rejects.toMatchObject({
      name: "StorageBootstrapGateError",
      code: "old_process_active"
    });

    // Case B: no owner file at all (e.g. v1.9.0 instance)
    await rm(join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE), { force: true });
    await expect(
      withStorageBootstrapGate(
        dbPath,
        {
          platform: "win32",
          bootstrapLockRoot: lockRoot,
          bootstrapOwnerPid: process.pid,
          mainInstanceId: "my-main-instance",
          fsOps: { open: mockOpen }
        },
        async () => "should-not-run"
      )
    ).rejects.toMatchObject({
      name: "StorageBootstrapGateError",
      code: "old_process_active"
    });
  });

  it("acquires and releases Windows lockfile normally when main exited (ENOENT) or left a stale unheld lockfile", async () => {
    for (const mode of ["deleted", "unheld-stale"] as const) {
      const root = await makeTempRoot(`dw-win-${mode}-`);
      const defaultProfile = join(root, "DeepWrite");
      const dbPath = join(
        defaultProfile,
        "renderer-state",
        "conversations.sqlite"
      );
      await mkdir(join(defaultProfile, "renderer-state"), { recursive: true });
      const lockRoot = resolveStorageBootstrapLockRoot(defaultProfile);
      await mkdir(lockRoot, { recursive: true });
      const lockFilePath = join(lockRoot, "lockfile");
      if (mode === "unheld-stale") {
        await writeFile(lockFilePath, "");
      }
      await writeFile(
        join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE),
        JSON.stringify({
          pid: process.pid,
          instanceId: "win-main-1",
          acquiredAt: new Date().toISOString()
        })
      );

      const mockOpen = createWinFileShareReadMockOpen(lockFilePath, mode);
      let ran = false;
      await withStorageBootstrapGate(
        dbPath,
        {
          platform: "win32",
          bootstrapLockRoot: lockRoot,
          bootstrapOwnerPid: process.pid,
          mainInstanceId: "win-main-1",
          fsOps: { open: mockOpen }
        },
        async (gate) => {
          gate.assertStillHeld();
          ran = true;
        }
      );
      expect(ran).toBe(true);
    }
  });

  it("tolerates unwritable parent directory for secondary relocated lock root when primary bootstrapLockRoot is held, while still rejecting primary gate failures", async () => {
    const root = await makeTempRoot("dw-relocated-perm-");
    const defaultProfile = join(root, "DefaultProfile");
    const primaryLockRoot = resolveStorageBootstrapLockRoot(defaultProfile);
    await mkdir(defaultProfile, { recursive: true });

    const readonlyMount = join(root, "readonly-mount");
    const relocatedProfile = join(readonlyMount, "DeepWriteData");
    const relocatedState = join(relocatedProfile, "renderer-state");
    const dbPath = join(relocatedState, "conversations.sqlite");
    await mkdir(relocatedState, { recursive: true });

    await chmod(readonlyMount, 0o555);
    readonlyDirs.push(readonlyMount);

    // Secondary inferred lock root `<readonlyMount>/.DeepWriteData.storage-bootstrap`
    // cannot be created (EACCES), but primary lock root succeeds -> allowed.
    let heldAssertOk = false;
    const result = await withStorageBootstrapGate(
      dbPath,
      { bootstrapLockRoot: primaryLockRoot },
      async (gate) => {
        gate.assertStillHeld();
        heldAssertOk = true;
        return "relocated-ok";
      }
    );
    expect(result).toBe("relocated-ok");
    expect(heldAssertOk).toBe(true);

    // Primary lock root unavailable MUST still reject.
    await expect(
      withStorageBootstrapGate(
        dbPath,
        {
          bootstrapLockRoot: primaryLockRoot,
          bootstrapGateMode: "unavailable"
        },
        async () => "should-not-run"
      )
    ).rejects.toBeInstanceOf(StorageBootstrapGateError);
  });
});
