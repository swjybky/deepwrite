import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationCompactionStatus } from "@deepwrite/contracts";
import { resolveStorageBootstrapLockRoot } from "@deepwrite/shared/node";
import { StorageLocationStore } from "../../main/storage-location-store";
import { ConversationDatabase } from "./database";
import { JsonNodes } from "./json-nodes";
import {
  inspectCompactionStatus,
  recoverCompactionOnStartup,
  releaseCompactionBackup,
  rollbackToCompactionBackup,
  runConversationCompaction,
  type CompactionDatabaseHandle
} from "./legacy-snapshot-compaction";
import { openConversationDatabase, Statements } from "./schema";
import { initializeConversationStorage } from "./worker-startup";

const tempRoots: string[] = [];
const repoRoot = resolve(import.meta.dirname, "../../../../..");
const jitiModulePath = join(
  repoRoot,
  "node_modules/.pnpm/node_modules/jiti/lib/jiti.mjs"
);
const jitiModuleUrl = pathToFileURL(jitiModulePath).href;

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(join(dirname(root), `.${basename(root)}.storage-bootstrap`), {
        recursive: true,
        force: true
      }).catch(() => undefined);
      for (const prefix of ["", "DeepWriteDefault", "RelocatedData"]) {
        for (const rel of [
          "renderer-state/conversations.sqlite.bak-v190",
          "renderer-state/conversations.sqlite.bak-v190-wal",
          "renderer-state/conversations.sqlite.bak-v190-shm"
        ]) {
          await chmod(join(root, prefix, rel), 0o600).catch(() => undefined);
        }
      }
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    })
  );
});

async function makeTempDbPath(prefix = "dw-high-risk-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return join(root, "renderer-state", "conversations.sqlite");
}

function makeHandle(
  databasePath: string,
  initialDb: ConversationDatabase,
  instanceId = "inst-high-risk-1",
  events: ConversationCompactionStatus[] = []
): CompactionDatabaseHandle & {
  current(): ConversationDatabase;
  blockedReason(): string | undefined;
} {
  let db = initialDb;
  let blocked: string | undefined;
  return {
    current: () => db,
    blockedReason: () => blocked,
    getDatabase: () => db,
    closeDatabase: () => {
      db.close();
    },
    reopenDatabase: () => {
      db = new ConversationDatabase(databasePath);
      db.claimMainInstance(instanceId);
      return db;
    },
    setWriteBlocked: (reason) => {
      blocked = reason;
    },
    onProgress: (status) => {
      events.push(status);
    }
  };
}

function makeUncompressibleProse(seed: number, targetChars: number): string {
  const vocab =
    "雾港钟楼夜雨石板街道灯影回声潮汐码头渡轮甲板长风星辰山脉荒原古城书阁墨迹竹简灯火窗棂微光残页";
  const chars: string[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < targetChars; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    chars.push(vocab[(state >>> 24) % vocab.length]!);
  }
  return chars.join("");
}

function insertRawObject(
  sql: Statements,
  nodes: JsonNodes,
  val: unknown
): { node: number; bytes: number; chars: number } {
  if (val === null || typeof val !== "object") {
    if (typeof val !== "string" || val.length < 4096) {
      const encoded = JSON.stringify(val);
      return {
        node: 0,
        bytes: Buffer.byteLength(encoded),
        chars: encoded.length
      };
    }
    return nodes.create(val) as { node: number; bytes: number; chars: number };
  }
  const id = Number(
    sql.get("INSERT INTO nodes(kind) VALUES ('pending')").run().lastInsertRowid
  );
  let nodeObj: unknown;
  let bytes = 2;
  let chars = 2;
  if (Array.isArray(val)) {
    const entries = val.map((item) => {
      if (item !== null && typeof item === "object") {
        return insertRawObject(sql, nodes, item);
      }
      if (typeof item === "string" && item.length >= 4096) {
        return nodes.create(item);
      }
      const enc = JSON.stringify(item);
      return { value: item, bytes: Buffer.byteLength(enc), chars: enc.length };
    });
    nodeObj = { kind: "array", entries };
    bytes += entries.reduce((acc, e) => acc + e.bytes + 1, 0);
    chars += entries.reduce((acc, e) => acc + e.chars + 1, 0);
  } else {
    const entries = Object.entries(val).map(([k, v]) => {
      let childRef: Record<string, unknown>;
      if (v !== null && typeof v === "object") {
        childRef = insertRawObject(sql, nodes, v);
      } else if (typeof v === "string" && v.length >= 4096) {
        childRef = nodes.create(v);
      } else {
        const enc = JSON.stringify(v);
        childRef = {
          value: v,
          bytes: Buffer.byteLength(enc),
          chars: enc.length
        };
      }
      bytes +=
        Buffer.byteLength(JSON.stringify(k)) + 2 + Number(childRef.bytes);
      chars += JSON.stringify(k).length + 2 + Number(childRef.chars);
      return [k, childRef];
    });
    nodeObj = { kind: "object", entries };
  }
  sql
    .get("UPDATE nodes SET kind = ?, value = ? WHERE id = ?")
    .run(Array.isArray(val) ? "array" : "object", JSON.stringify(nodeObj), id);
  return { node: id, bytes, chars };
}

async function seedV190WalDatabase(databasePath: string): Promise<{
  scopeKey: string;
  ckptSessionId: string;
  walSessionId: string;
  ckptAssistId: string;
  walAssistId: string;
}> {
  const stageDir = await mkdtemp(join(tmpdir(), "dw-seed-wal-stage-"));
  tempRoots.push(stageDir);
  const stageDbPath = join(stageDir, "conversations.sqlite");
  const db = openConversationDatabase(stageDbPath);
  const sql = new Statements(db);
  const nodes = new JsonNodes(sql);

  const scopeKey = "conversation-history:long%3Ahigh-risk-book%3Achat";
  const ckptSessionId = "sess-ckpt";
  const walSessionId = "sess-wal-only";
  const ckptAssistId = "msg-ckpt-ast";
  const walAssistId = "msg-wal-ast";
  const bigPrompt = makeUncompressibleProse(901, 40_000);

  const buildRichAssistant = (id: string, suffix: string) => ({
    id,
    role: "assistant",
    status: "completed",
    runId: `run-${suffix}`,
    createdAt: "2026-11-23T10:00:00.000Z",
    content: `正文回复-${suffix}`,
    runtime: { provider: "openai", model: "gpt-4o", mode: "provider" },
    toolCalls: [
      {
        id: `tc-${suffix}`,
        name: "spawn_subagent",
        args: {},
        status: "completed",
        requestedAt: "2026-11-23T09:59:00.000Z",
        completedAt: "2026-11-23T09:59:50.000Z",
        resultSummary: "核查通过"
      }
    ],
    editProposals: [
      {
        id: `prop-${suffix}`,
        runId: `run-${suffix}`,
        workspaceId: "high-risk-book",
        stageId: "draft",
        documentId: "chapter-150",
        title: `第150章润色-${suffix}`,
        summary: "保留润色与撤销快照",
        status: "accepted",
        baseRevision: "r1",
        proposedRevision: "r2",
        toolCallIds: [`tc-${suffix}`],
        additions: 1,
        deletions: 1,
        hunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: "context", text: "海雾漫过石阶。" },
              { type: "deletion", text: `旧句子-${suffix}` },
              { type: "addition", text: `新句子-${suffix}` }
            ]
          }
        ],
        discardSnapshot: {
          beforeText: `海雾漫过石阶。\n旧句子-${suffix}`,
          appliedProjectRevision: 7
        },
        createdAt: "2026-11-23T09:59:55.000Z",
        updatedAt: "2026-11-23T10:00:00.000Z"
      }
    ],
    subagentRuns: [
      {
        parentToolCallId: `tc-${suffix}`,
        subagentRunId: `sr-${suffix}`,
        subagentId: "style_reviewer",
        name: "文风审校",
        status: "completed",
        startedAt: "2026-11-23T09:59:05.000Z",
        completedAt: "2026-11-23T09:59:45.000Z",
        runtime: { provider: "openai", model: "gpt-4o", mode: "provider" },
        task: "连续性检查",
        output: `通过-${suffix}`,
        toolCalls: [],
        processingSteps: [
          {
            id: `ps-${suffix}`,
            type: "response",
            content: "完成",
            createdAt: "2026-11-23T09:59:40.000Z"
          }
        ],
        modelCalls: [
          {
            requestId: `req-${suffix}`,
            sequence: 1,
            requestedProvider: "openai",
            requestedModel: "gpt-4o",
            responseModel: null,
            responseModelEvidence: "unknown",
            startedAt: "2026-11-23T09:59:10.000Z",
            status: "completed",
            snapshot: {
              systemPrompt: bigPrompt,
              messages: [{ role: "user", content: bigPrompt }],
              tools: [{ name: "read", description: "read chapter" }],
              providerInput: { system: bigPrompt, messages: [] }
            }
          }
        ]
      }
    ]
  });

  // 1. Insert checkpointed session first, then TRUNCATE into main .sqlite.
  db.exec("BEGIN IMMEDIATE");
  sql
    .get(
      "INSERT INTO scopes(key, active_session_id, metadata_ref, removed, epoch, incremental) VALUES (?, ?, NULL, 0, 0, 1)"
    )
    .run(scopeKey, walSessionId);
  sql
    .get(
      "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position, message_count, message_bytes, turn_count) VALUES (?, ?, 2, 0, 2, 0, ?, '2026-11-23T09:50:00.000Z', 0, 0, 0, 0)"
    )
    .run(
      scopeKey,
      ckptSessionId,
      JSON.stringify(
        nodes.create({
          sessionId: ckptSessionId,
          draft: "",
          approvalMode: "auto-approve",
          createdAt: "2026-11-23T09:00:00.000Z",
          updatedAt: "2026-11-23T09:50:00.000Z",
          temperature: 0.7
        })
      )
    );
  const ckptRef = insertRawObject(
    sql,
    nodes,
    buildRichAssistant(ckptAssistId, "ckpt")
  );
  sql
    .get(
      "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, 0, ?, ?, 'assistant', '正文回复-ckpt', 0, 0, 0)"
    )
    .run(
      scopeKey,
      ckptSessionId,
      ckptAssistId,
      JSON.stringify(ckptRef),
      ckptRef.bytes
    );
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint = 0;");

  // 2. Insert WAL-only session committed strictly inside `-wal` (never checkpointed!).
  db.exec("BEGIN IMMEDIATE");
  sql
    .get(
      "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position, message_count, message_bytes, turn_count) VALUES (?, ?, 3, 0, 3, 0, ?, '2026-11-23T10:00:00.000Z', 1, 0, 0, 0)"
    )
    .run(
      scopeKey,
      walSessionId,
      JSON.stringify(
        nodes.create({
          sessionId: walSessionId,
          draft: "wal-draft",
          approvalMode: "auto-approve",
          createdAt: "2026-11-23T09:55:00.000Z",
          updatedAt: "2026-11-23T10:00:00.000Z",
          temperature: 0.7
        })
      )
    );
  const walRef = insertRawObject(
    sql,
    nodes,
    buildRichAssistant(walAssistId, "wal")
  );
  sql
    .get(
      "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, 0, ?, ?, 'assistant', '正文回复-wal', 0, 0, 0)"
    )
    .run(
      scopeKey,
      walSessionId,
      walAssistId,
      JSON.stringify(walRef),
      walRef.bytes
    );
  db.exec("COMMIT");

  // Copy active (uncheckpointed) DB + WAL + SHM BEFORE closing seed db!
  await mkdir(dirname(databasePath), { recursive: true });
  await copyFile(stageDbPath, databasePath);
  if (existsSync(`${stageDbPath}-wal`)) {
    await copyFile(`${stageDbPath}-wal`, `${databasePath}-wal`);
  }
  if (existsSync(`${stageDbPath}-shm`)) {
    await copyFile(`${stageDbPath}-shm`, `${databasePath}-shm`);
  }
  db.close();

  // Verify the main file alone does NOT contain `walSessionId`, proving it lives only in `-wal`.
  const verifyMainOnly = join(stageDir, "verify-main-only.sqlite");
  await copyFile(databasePath, verifyMainOnly);
  const probe = new DatabaseSync(verifyMainOnly, { readOnly: true });
  const mainOnlyCount = Number(
    (
      probe
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?")
        .get(walSessionId) as { c: number }
    ).c
  );
  probe.close();
  expect(mainOnlyCount).toBe(0);

  return { scopeKey, ckptSessionId, walSessionId, ckptAssistId, walAssistId };
}

describe("legacy snapshot compaction: high-risk multi-process, crash recovery & retries", () => {
  it("excludes running v1.9.0-shaped independent child process holding WAL connection without directory lock, defers safely, keeps normal usage alive, and succeeds on retry after exit", async () => {
    const dbPath = await makeTempDbPath();
    const { scopeKey, walSessionId } = await seedV190WalDatabase(dbPath);

    // Spawn independent v1.9.0-shaped process (ignores .deepwrite/project-transaction.lock),
    // writes a fresh message in WAL mode, and keeps connection open idle.
    const childScript = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
      db.exec("BEGIN IMMEDIATE");
      const nodeRes = db.prepare("INSERT INTO nodes(kind, value) VALUES ('object', ?)").run(
        JSON.stringify({
          kind: "object",
          entries: [
            ["id", { value: "msg-v190-independent", bytes: 22, chars: 22 }],
            ["role", { value: "user", bytes: 6, chars: 6 }],
            ["content", { value: "旧版进程仍在运行中写入的消息", bytes: 44, chars: 16 }],
            ["createdAt", { value: "2026-11-23T10:05:00.000Z", bytes: 26, chars: 26 }]
          ]
        })
      );
      const ref = JSON.stringify({ node: Number(nodeRes.lastInsertRowid), bytes: 120, chars: 100 });
      db.prepare("INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, 'msg-v190-independent', 1, ?, 120, 'user', '旧版进程仍在运行中写入的消息', 0, 0, 0)")
        .run(${JSON.stringify(scopeKey)}, ${JSON.stringify(walSessionId)}, ref);
      db.prepare("UPDATE sessions SET revision = revision + 1, sequence = sequence + 1 WHERE scope_key = ? AND session_id = ?")
        .run(${JSON.stringify(scopeKey)}, ${JSON.stringify(walSessionId)});
      db.exec("COMMIT");
      process.stdout.write("V190_READY\\n");
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", childScript],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr += String(d);
        });
        child.stdout.on("data", (d) => {
          if (String(d).includes("V190_READY")) resolveReady();
        });
        child.on("exit", (code) =>
          rejectReady(
            new Error(`v1.9.0 child exited unexpectedly (${code}): ${stderr}`)
          )
        );
      });

      const liveDb = new ConversationDatabase(dbPath);
      liveDb.claimMainInstance("inst-new-upgrader");
      const handle = makeHandle(dbPath, liveDb, "inst-new-upgrader");

      // Must NOT trust directory lock; SQLite EXCLUSIVE check detects independent v1.9.0 process!
      const deferred = await runConversationCompaction(handle, {
        minDiskHeadroomBytes: 1024
      });
      expect(deferred.phase).toBe("failed");
      expect(deferred.failureCode).toBe("database_locked");
      expect(deferred.canRetry).toBe(true);
      expect(handle.blockedReason()).toBeUndefined();

      // Ordinary reading continues cleanly even after lock deferral, seeing v1.9.0's committed write.
      const pageWhileActive = handle.current().messages({
        key: scopeKey,
        sessionId: walSessionId,
        limit: 10
      });
      expect(pageWhileActive.messages.map((m) => m.messageId)).toContain(
        "msg-v190-independent"
      );

      // Kill/exit independent v1.9.0 process cleanly.
      child.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        child.once("exit", () => resolveExit());
      });

      // Normal write in new app succeeds before retry compaction.
      handle.current().commit({
        key: scopeKey,
        sessionId: walSessionId,
        batchId: "batch-normal-after-defer",
        expectedRevision: pageWhileActive.revision,
        generation: 0,
        sequence: 99,
        operations: [
          {
            type: "putMessage",
            messageId: "msg-normal-use-after-defer",
            position: 2,
            value: {
              id: "msg-normal-use-after-defer",
              role: "user",
              content: "推迟期间仍可正常继续对话",
              createdAt: "2026-11-23T10:06:00.000Z"
            }
          }
        ]
      });

      const retried = await runConversationCompaction(handle, {
        minDiskHeadroomBytes: 1024
      });
      expect(retried.phase).toBe("completed_with_backup");
      expect(retried.legacyCallsFound).toBe(0);

      const finalMsgs = handle.current().messages({
        key: scopeKey,
        sessionId: walSessionId,
        limit: 10
      });
      expect(finalMsgs.messages.map((m) => m.messageId)).toEqual([
        "msg-wal-ast",
        "msg-v190-independent",
        "msg-normal-use-after-defer"
      ]);
      handle.current().close();
    } finally {
      if (!child.killed && child.exitCode === null) child.kill("SIGKILL");
    }
  });

  it("detects uncooperative raw SQLite child racing into the Windows close-before-rename window, blocks backup mutation via read-only triggers, and recovers cleanly on retry", async () => {
    for (const mode of ["commitAndClose", "commitAndHoldOpen"] as const) {
      const dbPath = await makeTempDbPath(`dw-race-${mode}-`);
      const { scopeKey, walSessionId, walAssistId } =
        await seedV190WalDatabase(dbPath);
      const liveDb = new ConversationDatabase(dbPath);
      liveDb.claimMainInstance(`inst-race-${mode}`);
      const handle = makeHandle(dbPath, liveDb, `inst-race-${mode}`);

      let heldChild: ReturnType<typeof spawn> | undefined;
      let intruderWriteError = "";
      try {
        const result = await runConversationCompaction(handle, {
          minDiskHeadroomBytes: 1024,
          swapStrategy: "windows-rename",
          testHooks: {
            afterSourceCloseBeforeBackupRename: async ({ databasePath }) => {
              // Uncooperative child bypasses `.storage-bootstrap` and touches dbPath directly:
              // 1) switching journal_mode to WAL alters the 100B header so compaction detects the race;
              // 2) pre-committed backup read-only triggers block any silent SQL INSERT on the old inode.
              const script = `
                import { DatabaseSync } from "node:sqlite";
                const db = new DatabaseSync(${JSON.stringify(databasePath)});
                db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
                let insertErr = "";
                try {
                  db.exec("BEGIN IMMEDIATE; INSERT INTO nodes(kind, value) VALUES ('object', '{}'); COMMIT;");
                } catch (e) {
                  insertErr = String(e.message || e);
                  try { db.exec("ROLLBACK;"); } catch {}
                }
                ${
                  mode === "commitAndClose"
                    ? "db.close(); process.stdout.write('RACE_DONE:' + insertErr + '\\n'); process.exit(0);"
                    : "process.stdout.write('RACE_HELD:' + insertErr + '\\n'); setInterval(() => {}, 1000);"
                }
              `;
              if (mode === "commitAndClose") {
                const res = spawnSync(
                  process.execPath,
                  ["--input-type=module", "-e", script],
                  { encoding: "utf8" }
                );
                if (res.status !== 0) {
                  throw new Error(`Race child failed: ${res.stderr}`);
                }
                intruderWriteError = res.stdout;
              } else {
                heldChild = spawn(
                  process.execPath,
                  ["--input-type=module", "-e", script],
                  { stdio: ["ignore", "pipe", "pipe"] }
                );
                await new Promise<void>((resolveReady, rejectReady) => {
                  heldChild!.stdout!.on("data", (d) => {
                    const text = String(d);
                    intruderWriteError += text;
                    if (text.includes("RACE_HELD")) resolveReady();
                  });
                  heldChild!.on("exit", (c) =>
                    rejectReady(new Error(`Held race child exited: ${c}`))
                  );
                });
              }
            }
          }
        });

        expect(intruderWriteError).toContain(
          "deepwrite_compaction_backup_readonly"
        );
        expect(result.phase).toBe("failed");
        expect(result.failureCode).toBe("database_locked");
        expect(result.canRetry).toBe(true);

        if (heldChild) {
          heldChild.kill("SIGTERM");
          await new Promise<void>((resolveExit) => {
            heldChild!.once("exit", () => resolveExit());
          });
          heldChild = undefined;
        }

        try {
          handle.current().close();
        } catch {
          /* Handle may already be closed if reopen threw under contention. */
        }

        // Reopening live database automatically unseals triggers and keeps all sessions intact.
        const checkDb = new ConversationDatabase(dbPath);
        checkDb.claimMainInstance(`inst-verify-${mode}`);
        const msgs = checkDb.messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        });
        expect(msgs.messages.map((m) => m.messageId)).toEqual([walAssistId]);

        // Unsealed DB still supports normal writes cleanly, and retry finishes compaction.
        checkDb.commit({
          key: scopeKey,
          sessionId: walSessionId,
          batchId: `batch-after-race-${mode}`,
          expectedRevision: msgs.revision,
          generation: 0,
          sequence: 60,
          operations: [
            {
              type: "putMessage",
              messageId: `msg-after-race-${mode}`,
              position: 1,
              value: {
                id: `msg-after-race-${mode}`,
                role: "user",
                content: `竞态拦截恢复后的正常写入-${mode}`,
                createdAt: "2026-11-23T10:15:00.000Z"
              }
            }
          ]
        });
        const retryHandle = makeHandle(dbPath, checkDb, `inst-verify-${mode}`);
        const compacted = await runConversationCompaction(retryHandle, {
          minDiskHeadroomBytes: 1024,
          swapStrategy: "windows-rename"
        });
        expect(compacted.phase).toBe("completed_with_backup");
        const afterRetryMsgs = retryHandle.current().messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        });
        expect(afterRetryMsgs.messages.map((m) => m.messageId)).toEqual([
          walAssistId,
          `msg-after-race-${mode}`
        ]);
        retryHandle.current().close();
      } finally {
        if (heldChild && heldChild.exitCode === null) heldChild.kill("SIGKILL");
        try {
          handle.current().close();
        } catch {
          /* Handle may already be closed cleanly above. */
        }
      }
    }
  }, 60_000);

  it("recovers across real child-process abrupt exit (process.exit) at candidate-build, post-backup-rename, and post-candidate-swap boundaries while preserving WAL-only committed data and post-upgrade rollback guard", async () => {
    const scenarios = [
      {
        hook: "duringCandidateBuild" as const,
        strategy: "windows-rename" as const
      },
      {
        hook: "afterBackupBeforeSwap" as const,
        strategy: "windows-rename" as const
      },
      {
        hook: "afterCandidateSwapBeforeReopen" as const,
        strategy: "windows-rename" as const
      },
      ...(process.platform === "win32"
        ? []
        : [
            {
              hook: "afterCandidateSwapBeforeReopen" as const,
              strategy: "posix-hardlink" as const
            }
          ])
    ];

    for (const scenario of scenarios) {
      const dbPath = await makeTempDbPath(
        `dw-crash-${scenario.hook}-${scenario.strategy}-`
      );
      const { scopeKey, ckptSessionId, walSessionId, walAssistId } =
        await seedV190WalDatabase(dbPath);

      const childRunner = `
        import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
        const jiti = createJiti(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))}, {
          interopDefault: true,
          moduleCache: false,
          alias: {
            "@deepwrite/contracts/renderer": ${JSON.stringify(join(repoRoot, "packages/contracts/src/renderer.ts"))},
            "@deepwrite/contracts": ${JSON.stringify(join(repoRoot, "packages/contracts/src/index.ts"))},
            "@deepwrite/shared/node": ${JSON.stringify(join(repoRoot, "packages/shared/src/node.ts"))},
            "@deepwrite/shared": ${JSON.stringify(join(repoRoot, "packages/shared/src/index.ts"))}
          }
        });
        const { ConversationDatabase } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))});
        const { runConversationCompaction } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/legacy-snapshot-compaction.ts"))});
        const dbPath = ${JSON.stringify(dbPath)};
        let db = new ConversationDatabase(dbPath);
        db.claimMainInstance("crash-child");
        const handle = {
          getDatabase: () => db,
          closeDatabase: () => db.close(),
          reopenDatabase: () => {
            db = new ConversationDatabase(dbPath);
            db.claimMainInstance("crash-child");
            return db;
          },
          setWriteBlocked: () => {}
        };
        await runConversationCompaction(handle, {
          minDiskHeadroomBytes: 1024,
          swapStrategy: ${JSON.stringify(scenario.strategy)},
          testHooks: {
            ${scenario.hook}: () => {
              process.exit(99);
            }
          }
        });
      `;

      const crashResult = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childRunner],
        { encoding: "utf8" }
      );
      expect(crashResult.status, crashResult.stderr).toBe(99);

      if (scenario.hook === "afterBackupBeforeSwap") {
        expect(existsSync(dbPath)).toBe(false);
        expect(existsSync(`${dbPath}.bak-v190`)).toBe(true);
      }

      // Simulate next-launch normal startup recovery path via initializeConversationStorage.
      const startupFailures: unknown[] = [];
      const recovered = await initializeConversationStorage(
        { databasePath: dbPath },
        "inst-post-crash",
        (failure) => startupFailures.push(failure)
      );
      expect(startupFailures).toEqual([]);

      // Leftover candidate/prev temp files must be completely cleaned on startup.
      const filesAfterStartup = await readdir(dirname(dbPath));
      expect(filesAfterStartup.some((f) => f.includes(".candidate-"))).toBe(
        false
      );
      expect(filesAfterStartup.some((f) => f.includes(".bak-prev-"))).toBe(
        false
      );

      // WAL-only session + checkpointed session + edit proposal hunks + discardSnapshot are intact!
      const walPage = recovered.messages({
        key: scopeKey,
        sessionId: walSessionId,
        limit: 10
      });
      expect(walPage.messages).toHaveLength(1);
      expect(walPage.messages[0]?.messageId).toBe(walAssistId);
      const walDetail = JSON.parse(
        recovered.detail({
          key: scopeKey,
          sessionId: walSessionId,
          messageId: walAssistId,
          expectedRevision: walPage.revision,
          path: []
        }).chunk
      ) as {
        toolCalls: { id: string }[];
        editProposals: {
          hunks: unknown[];
          discardSnapshot: { beforeText: string };
        }[];
        subagentRuns: {
          modelCalls: { status: string; snapshot?: unknown }[];
        }[];
      };
      expect(walDetail.toolCalls).toHaveLength(1);
      expect(walDetail.editProposals[0]?.hunks).toHaveLength(1);
      expect(walDetail.editProposals[0]?.discardSnapshot.beforeText).toBe(
        "海雾漫过石阶。\n旧句子-wal"
      );

      const ckptPage = recovered.messages({
        key: scopeKey,
        sessionId: ckptSessionId,
        limit: 10
      });
      expect(ckptPage.messages).toHaveLength(1);

      const postStatus = await inspectCompactionStatus(recovered);
      const recoverHandle = makeHandle(dbPath, recovered, "inst-post-crash");

      if (scenario.hook === "afterCandidateSwapBeforeReopen") {
        expect(postStatus.phase).toBe("completed_with_backup");
        expect(postStatus.legacyCallsFound).toBe(0);
        expect(
          walDetail.subagentRuns[0]?.modelCalls[0]?.snapshot
        ).toBeUndefined();

        // New write after crash-completed swap MUST block silent rollback!
        recovered.commit({
          key: scopeKey,
          sessionId: walSessionId,
          batchId: "post-crash-swap-new-msg",
          expectedRevision: walPage.revision,
          generation: 0,
          sequence: 50,
          operations: [
            {
              type: "putMessage",
              messageId: "msg-after-crash-swap",
              position: 1,
              value: {
                id: "msg-after-crash-swap",
                role: "user",
                content: "崩溃切换恢复后的新写消息",
                createdAt: "2026-11-23T11:00:00.000Z"
              }
            }
          ]
        });
        const rollbackAttempt = await rollbackToCompactionBackup(
          recoverHandle,
          { lockTimeoutMs: 500 }
        );
        expect(rollbackAttempt.failureCode).toBe("post_backup_changes_present");
        expect(rollbackAttempt.canRollback).toBe(false);
        const afterGuardMsgs = recoverHandle.current().messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        });
        expect(afterGuardMsgs.messages.map((m) => m.messageId)).toContain(
          "msg-after-crash-swap"
        );
      } else {
        // Crash before swap restored original v1.9.0 DB including WAL-only session; retry completes!
        expect(postStatus.legacyCallsFound).toBe(2);
        const retryResult = await runConversationCompaction(recoverHandle, {
          minDiskHeadroomBytes: 1024,
          swapStrategy: scenario.strategy
        });
        expect(retryResult.phase).toBe("completed_with_backup");
        expect(retryResult.legacyCallsFound).toBe(0);
      }

      recoverHandle.current().close();
    }
  }, 60_000);

  it("retries transient Windows EPERM/EBUSY errors during swap and preserves normal usage plus data safety on persistent EPERM/EBUSY", async () => {
    const dbPath = await makeTempDbPath("dw-win-eperm-");
    const { scopeKey, walSessionId, walAssistId } =
      await seedV190WalDatabase(dbPath);
    const liveDb = new ConversationDatabase(dbPath);
    liveDb.claimMainInstance("inst-win-eperm");
    const handle = makeHandle(dbPath, liveDb, "inst-win-eperm");

    // 1. Transient EPERM on backup rename and transient EBUSY on candidate link -> retryFsOp succeeds.
    let renameAttempt = 0;
    let linkAttempt = 0;
    const okStatus = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024,
      swapStrategy: "windows-rename",
      fsOps: {
        rename: async (src, dst) => {
          renameAttempt += 1;
          if (renameAttempt === 1) {
            throw Object.assign(new Error("EPERM transient"), {
              code: "EPERM"
            });
          }
          await rename(src, dst);
        },
        link: async (src, dst) => {
          linkAttempt += 1;
          if (linkAttempt === 1) {
            throw Object.assign(new Error("EBUSY transient"), {
              code: "EBUSY"
            });
          }
          await link(src, dst);
        }
      }
    });
    expect(okStatus.phase).toBe("completed_with_backup");
    expect(renameAttempt).toBeGreaterThanOrEqual(2);
    expect(linkAttempt).toBeGreaterThanOrEqual(2);
    handle.current().close();

    // 2. Persistent EBUSY when linking candidate -> dbPath after backup moved:
    //    must restore backup -> dbPath non-overwritingly, unseal cleanly, allow immediate writes, then retry.
    const dbPath2 = await makeTempDbPath("dw-win-persist-");
    await seedV190WalDatabase(dbPath2);
    const liveDb2 = new ConversationDatabase(dbPath2);
    liveDb2.claimMainInstance("inst-win-persist");
    const handle2 = makeHandle(dbPath2, liveDb2, "inst-win-persist");

    const persistentFail = await runConversationCompaction(handle2, {
      minDiskHeadroomBytes: 1024,
      swapStrategy: "windows-rename",
      fsOps: {
        link: async (src, dst) => {
          if (String(src).includes(".candidate-")) {
            throw Object.assign(new Error("EBUSY AV scanner"), {
              code: "EBUSY"
            });
          }
          await link(src, dst);
        }
      }
    });
    expect(persistentFail.phase).toBe("failed");
    expect(persistentFail.failureCode).toBe("swap_failed");
    expect(persistentFail.canRetry).toBe(true);
    expect(existsSync(dbPath2)).toBe(true);
    expect(existsSync(`${dbPath2}.bak-v190`)).toBe(false);

    // Ordinary reading and writing remain 100% functional after persistent swap EBUSY failure!
    const pageAfterFail = handle2.current().messages({
      key: scopeKey,
      sessionId: walSessionId,
      limit: 10
    });
    expect(pageAfterFail.messages.map((m) => m.messageId)).toContain(
      walAssistId
    );
    handle2.current().commit({
      key: scopeKey,
      sessionId: walSessionId,
      batchId: "batch-normal-after-ebusy",
      expectedRevision: pageAfterFail.revision,
      generation: 0,
      sequence: 77,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-normal-after-ebusy",
          position: 1,
          value: {
            id: "msg-normal-after-ebusy",
            role: "user",
            content: "Windows EBUSY 推迟后仍可正常保存对话",
            createdAt: "2026-11-23T11:20:00.000Z"
          }
        }
      ]
    });

    // Clearing AV lock lets retry finish cleanly preserving the message written while failed.
    const retried = await runConversationCompaction(handle2, {
      minDiskHeadroomBytes: 1024,
      swapStrategy: "windows-rename"
    });
    expect(retried.phase).toBe("completed_with_backup");
    const finalPage = handle2.current().messages({
      key: scopeKey,
      sessionId: walSessionId,
      limit: 10
    });
    expect(finalPage.messages.map((m) => m.messageId)).toEqual([
      walAssistId,
      "msg-normal-after-ebusy"
    ]);
    handle2.current().close();
  });

  it("keeps normal usage working when deferred by disk_full, succeeds after disk space recovers, and blocks rollback after new post-upgrade edits", async () => {
    const dbPath = await makeTempDbPath("dw-diskfull-flow-");
    const { scopeKey, walSessionId, walAssistId } =
      await seedV190WalDatabase(dbPath);
    const liveDb = new ConversationDatabase(dbPath);
    liveDb.claimMainInstance("inst-disk-flow");
    const handle = makeHandle(dbPath, liveDb, "inst-disk-flow");

    const diskFail = await runConversationCompaction(handle, {
      getAvailableDiskBytes: async () => 256 * 1024
    });
    expect(diskFail.phase).toBe("failed");
    expect(diskFail.failureCode).toBe("disk_full");
    expect(diskFail.canRetry).toBe(true);
    expect(handle.blockedReason()).toBeUndefined();

    // User continues normal writing while disk space is tight.
    const page1 = handle.current().messages({
      key: scopeKey,
      sessionId: walSessionId,
      limit: 10
    });
    handle.current().commit({
      key: scopeKey,
      sessionId: walSessionId,
      batchId: "batch-while-disk-full",
      expectedRevision: page1.revision,
      generation: 0,
      sequence: 12,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-during-disk-full",
          position: 1,
          value: {
            id: "msg-during-disk-full",
            role: "user",
            content: "磁盘紧张期间写入的正常对话",
            createdAt: "2026-11-23T12:00:00.000Z"
          }
        }
      ]
    });

    // Disk space recovered -> retry compaction succeeds!
    const compacted = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(compacted.phase).toBe("completed_with_backup");
    expect(compacted.legacyCallsFound).toBe(0);

    // Post-upgrade new edit/conversation must block backup overwrite!
    const page2 = handle.current().messages({
      key: scopeKey,
      sessionId: walSessionId,
      limit: 10
    });
    handle.current().commit({
      key: scopeKey,
      sessionId: walSessionId,
      batchId: "batch-post-upgrade-edit",
      expectedRevision: page2.revision,
      generation: 0,
      sequence: 13,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-post-upgrade",
          position: 2,
          value: {
            id: "msg-post-upgrade",
            role: "user",
            content: "升级后产生的新消息不可被回滚覆盖",
            createdAt: "2026-11-23T12:05:00.000Z"
          }
        }
      ]
    });
    const rollbackGuard = await rollbackToCompactionBackup(handle, {
      lockTimeoutMs: 500
    });
    expect(rollbackGuard.failureCode).toBe("post_backup_changes_present");
    expect(rollbackGuard.canRollback).toBe(false);

    const released = await releaseCompactionBackup(handle);
    expect(released.phase).toBe("backup_released");
    expect(released.netFreedBytes).toBeGreaterThan(0);

    // Confirm all history + edit proposals + discardSnapshot + post-upgrade message remain intact.
    const page3 = handle.current().messages({
      key: scopeKey,
      sessionId: walSessionId,
      limit: 10
    });
    expect(page3.messages.map((m) => m.messageId)).toEqual([
      walAssistId,
      "msg-during-disk-full",
      "msg-post-upgrade"
    ]);
    const detail = JSON.parse(
      handle.current().detail({
        key: scopeKey,
        sessionId: walSessionId,
        messageId: walAssistId,
        expectedRevision: page3.revision,
        path: []
      }).chunk
    ) as {
      editProposals: {
        hunks: unknown[];
        discardSnapshot: { beforeText: string };
      }[];
      subagentRuns: { modelCalls: { snapshot?: unknown; status: string }[] }[];
    };
    expect(detail.editProposals[0]?.hunks).toHaveLength(1);
    expect(detail.editProposals[0]?.discardSnapshot.beforeText).toBe(
      "海雾漫过石阶。\n旧句子-wal"
    );
    expect(detail.subagentRuns[0]?.modelCalls[0]?.status).toBe("completed");
    expect(detail.subagentRuns[0]?.modelCalls[0]?.snapshot).toBeUndefined();
    handle.current().close();
  });

  it("enforces v1.9.0 .DeepWrite.storage-bootstrap cross-version gate across relocated profiles, source-renamed pre-swap window, and startup crash recovery", async () => {
    const buildV190LaunchScript = (
      defaultProfileDir: string,
      mode: "holdLockIdle" | "tryLaunchAndWrite"
    ) => `
      import { join } from "node:path";
      import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
      const jiti = createJiti(${JSON.stringify(join(repoRoot, "apps/desktop/src/main/storage-bootstrap.ts"))}, {
        interopDefault: true,
        moduleCache: false,
        alias: {
          "@deepwrite/contracts/renderer": ${JSON.stringify(join(repoRoot, "packages/contracts/src/renderer.ts"))},
          "@deepwrite/contracts": ${JSON.stringify(join(repoRoot, "packages/contracts/src/index.ts"))},
          "@deepwrite/shared/node": ${JSON.stringify(join(repoRoot, "packages/shared/src/node.ts"))},
          "@deepwrite/shared": ${JSON.stringify(join(repoRoot, "packages/shared/src/index.ts"))}
        }
      });
      const { acquireStorageInstanceLock, initializeStorageLocation } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/main/storage-bootstrap.ts"))});
      const { tryAcquireChromiumSingletonLockSync } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/bootstrap-gate.ts"))});
      const { ConversationDatabase } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))});

      const paths = {
        userData: ${JSON.stringify(defaultProfileDir)},
        sessionData: ${JSON.stringify(defaultProfileDir)}
      };
      let heldLock = undefined;
      const v190App = {
        getPath: (name) => paths[name] ?? paths.userData,
        setPath: (name, value) => { paths[name] = value; },
        requestSingleInstanceLock: () => {
          const res = tryAcquireChromiumSingletonLockSync(paths.userData);
          if (res.acquired) heldLock = res;
          return res.acquired;
        }
      };

      // Exact v1.9.0 startup order: acquireStorageInstanceLock() before initializeStorageLocation()
      const gotLock = acquireStorageInstanceLock(v190App);
      if (!gotLock) {
        process.stdout.write("V190_LOCK_REFUSED\\n");
        process.exit(0);
      }

      try {
        initializeStorageLocation(v190App);
        if (${JSON.stringify(mode)} === "holdLockIdle") {
          process.stdout.write("V190_LOCK_HELD\\n");
          const keepAlive = setInterval(() => {}, 1000);
          await new Promise((resolveExit) => {
            process.once("SIGTERM", resolveExit);
            process.once("SIGINT", resolveExit);
          });
          clearInterval(keepAlive);
        } else {
          const dbPath = join(paths.userData, "renderer-state", "conversations.sqlite");
          const db = new ConversationDatabase(dbPath);
          db.claimMainInstance("v190-unexpected-winner");
          db.close();
          process.stdout.write("V190_UNEXPECTED_WRITE\\n");
        }
      } finally {
        heldLock?.release();
      }
      process.exit(0);
    `;

    // 1. Relocated profile (`DeepWriteDefault` -> `RelocatedData`): even idle v1.9.0 holding
    //    `<root>/.DeepWriteDefault.storage-bootstrap` (with NO SQLite handle open) must block compaction.
    const root1 = await mkdtemp(join(tmpdir(), "dw-bs-relocated-"));
    tempRoots.push(root1);
    const defaultProfile1 = join(root1, "DeepWriteDefault");
    const relocatedProfile1 = join(root1, "RelocatedData");
    const relocatedDb1 = join(
      relocatedProfile1,
      "renderer-state",
      "conversations.sqlite"
    );
    await mkdir(defaultProfile1, { recursive: true });
    await seedV190WalDatabase(relocatedDb1);
    const store1 = new StorageLocationStore(defaultProfile1);
    store1.schedule(relocatedProfile1, false);
    store1.complete();

    const lockRoot1 = resolveStorageBootstrapLockRoot(defaultProfile1);
    const idleV190 = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        buildV190LaunchScript(defaultProfile1, "holdLockIdle")
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        let stderr = "";
        idleV190.stderr.on("data", (d) => {
          stderr += String(d);
        });
        idleV190.stdout.on("data", (d) => {
          if (String(d).includes("V190_LOCK_HELD")) resolveReady();
        });
        idleV190.on("exit", (c) =>
          rejectReady(new Error(`Idle v1.9.0 exited (${c}): ${stderr}`))
        );
      });

      const db1 = new ConversationDatabase(relocatedDb1);
      db1.claimMainInstance("inst-relocated-1");
      const handle1 = makeHandle(relocatedDb1, db1, "inst-relocated-1");
      const blockedByBootstrap = await runConversationCompaction(handle1, {
        bootstrapLockRoot: lockRoot1,
        minDiskHeadroomBytes: 1024
      });
      expect(blockedByBootstrap.phase).toBe("failed");
      expect(blockedByBootstrap.failureCode).toBe("old_process_active");
      expect(blockedByBootstrap.canRetry).toBe(true);

      idleV190.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        idleV190.once("exit", () => resolveExit());
      });

      const afterV190Exit = await runConversationCompaction(handle1, {
        bootstrapLockRoot: lockRoot1,
        minDiskHeadroomBytes: 1024
      });
      expect(afterV190Exit.phase).toBe("completed_with_backup");
      handle1.current().close();
    } finally {
      if (idleV190.exitCode === null) idleV190.kill("SIGKILL");
      await rm(lockRoot1, { recursive: true, force: true }).catch(
        () => undefined
      );
    }

    // 2. While `windows-rename` has ALREADY moved source -> `.bak-v190` and `!existsSync(dbPath)`:
    //    launching v1.9.0 via `acquireStorageInstanceLock` is refused cleanly (`V190_LOCK_REFUSED`),
    //    never creates `dbPath`, and compaction completes preserving all sessions.
    const root2 = await mkdtemp(join(tmpdir(), "dw-bs-preswap-"));
    tempRoots.push(root2);
    const defaultProfile2 = join(root2, "DeepWriteDefault");
    const dbPath2 = join(
      defaultProfile2,
      "renderer-state",
      "conversations.sqlite"
    );
    const { scopeKey, ckptSessionId, walSessionId } =
      await seedV190WalDatabase(dbPath2);
    const lockRoot2 = resolveStorageBootstrapLockRoot(defaultProfile2);

    const db2 = new ConversationDatabase(dbPath2);
    db2.claimMainInstance("inst-preswap-2");
    const handle2 = makeHandle(dbPath2, db2, "inst-preswap-2");

    let preSwapLaunchOutput = "";
    try {
      const preSwapCompacted = await runConversationCompaction(handle2, {
        bootstrapLockRoot: lockRoot2,
        swapStrategy: "windows-rename",
        minDiskHeadroomBytes: 1024,
        testHooks: {
          afterBackupBeforeSwap: async ({ databasePath }) => {
            expect(existsSync(databasePath)).toBe(false);
            expect(existsSync(`${databasePath}.bak-v190`)).toBe(true);
            const probeRes = spawnSync(
              process.execPath,
              [
                "--input-type=module",
                "-e",
                buildV190LaunchScript(defaultProfile2, "tryLaunchAndWrite")
              ],
              { encoding: "utf8" }
            );
            expect(probeRes.status, probeRes.stderr).toBe(0);
            preSwapLaunchOutput = probeRes.stdout;
            expect(existsSync(databasePath)).toBe(false);
          }
        }
      });
      expect(preSwapLaunchOutput).toContain("V190_LOCK_REFUSED");
      expect(preSwapCompacted.phase).toBe("completed_with_backup");
      expect(
        handle2
          .current()
          .messages({ key: scopeKey, sessionId: ckptSessionId, limit: 10 })
          .messages
      ).toHaveLength(1);
      expect(
        handle2
          .current()
          .messages({ key: scopeKey, sessionId: walSessionId, limit: 10 })
          .messages
      ).toHaveLength(1);
      handle2.current().close();
    } finally {
      await rm(lockRoot2, { recursive: true, force: true }).catch(
        () => undefined
      );
    }

    // 3. Recovery phase exclusion under `.DeepWrite.storage-bootstrap`:
    //    Simulate missing `dbPath` + healthy `.bak-v190` (post-backup pre-swap abrupt exit):
    //    a) If v1.9.0 holds `.storage-bootstrap`, startup recovery refuses to open or create empty split-brain DB.
    //    b) Once v1.9.0 exits, startup recovery holds `.storage-bootstrap`, excludes v1.9.0 during restore,
    //       restores + unseals `.bak-v190` -> `dbPath`, and keeps WAL/checkpoint sessions intact.
    const root3 = await mkdtemp(join(tmpdir(), "dw-bs-recover-"));
    tempRoots.push(root3);
    const defaultProfile3 = join(root3, "DeepWriteDefault");
    const dbPath3 = join(
      defaultProfile3,
      "renderer-state",
      "conversations.sqlite"
    );
    await seedV190WalDatabase(dbPath3);
    const lockRoot3 = resolveStorageBootstrapLockRoot(defaultProfile3);

    const crashChild = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
          const jiti = createJiti(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))}, {
            interopDefault: true,
            moduleCache: false,
            alias: {
              "@deepwrite/contracts/renderer": ${JSON.stringify(join(repoRoot, "packages/contracts/src/renderer.ts"))},
              "@deepwrite/contracts": ${JSON.stringify(join(repoRoot, "packages/contracts/src/index.ts"))},
              "@deepwrite/shared/node": ${JSON.stringify(join(repoRoot, "packages/shared/src/node.ts"))},
              "@deepwrite/shared": ${JSON.stringify(join(repoRoot, "packages/shared/src/index.ts"))}
            }
          });
          const { ConversationDatabase } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))});
          const { runConversationCompaction } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/legacy-snapshot-compaction.ts"))});
          const dbPath = ${JSON.stringify(dbPath3)};
          let db = new ConversationDatabase(dbPath);
          db.claimMainInstance("crash-before-swap");
          const handle = {
            getDatabase: () => db,
            closeDatabase: () => db.close(),
            reopenDatabase: () => { db = new ConversationDatabase(dbPath); return db; },
            setWriteBlocked: () => {}
          };
          await runConversationCompaction(handle, {
            bootstrapLockRoot: ${JSON.stringify(lockRoot3)},
            minDiskHeadroomBytes: 1024,
            swapStrategy: "windows-rename",
            testHooks: {
              afterBackupBeforeSwap: () => process.exit(99)
            }
          });
        `
      ],
      { encoding: "utf8" }
    );
    expect(crashChild.status, crashChild.stderr).toBe(99);
    expect(existsSync(dbPath3)).toBe(false);
    expect(existsSync(`${dbPath3}.bak-v190`)).toBe(true);

    // Clear stale SingletonLock left by killed crashChild, then let v1.9.0 acquire it first.
    await rm(lockRoot3, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
    const v190HoldingForRecovery = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        buildV190LaunchScript(defaultProfile3, "holdLockIdle")
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        let stderr = "";
        v190HoldingForRecovery.stderr.on("data", (d) => {
          stderr += String(d);
        });
        v190HoldingForRecovery.stdout.on("data", (d) => {
          if (String(d).includes("V190_LOCK_HELD")) resolveReady();
        });
        v190HoldingForRecovery.on("exit", (c) =>
          rejectReady(
            new Error(`v190 recovery blocker exited (${c}): ${stderr}`)
          )
        );
      });

      const startupFailures: unknown[] = [];
      await expect(
        initializeConversationStorage(
          { databasePath: dbPath3 },
          "inst-recover-blocked",
          (f) => startupFailures.push(f)
        )
      ).rejects.toThrow();
      expect(existsSync(dbPath3)).toBe(false);
      expect(existsSync(`${dbPath3}.bak-v190`)).toBe(true);

      v190HoldingForRecovery.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        v190HoldingForRecovery.once("exit", () => resolveExit());
      });

      let recoveryLaunchOutput = "";
      await recoverCompactionOnStartup(dbPath3, {
        bootstrapLockRoot: lockRoot3,
        testHooks: {
          beforeRestoreBackup: ({ databasePath }) => {
            const probeRes = spawnSync(
              process.execPath,
              [
                "--input-type=module",
                "-e",
                buildV190LaunchScript(defaultProfile3, "tryLaunchAndWrite")
              ],
              { encoding: "utf8" }
            );
            expect(probeRes.status, probeRes.stderr).toBe(0);
            recoveryLaunchOutput = probeRes.stdout;
            expect(existsSync(databasePath)).toBe(false);
          }
        }
      });
      expect(recoveryLaunchOutput).toContain("V190_LOCK_REFUSED");
      expect(existsSync(dbPath3)).toBe(true);

      const recoveredDb = await initializeConversationStorage(
        { databasePath: dbPath3 },
        "inst-recover-ok",
        () => undefined
      );
      expect(
        recoveredDb.messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        }).messages
      ).toHaveLength(1);
      recoveredDb.close();
    } finally {
      if (v190HoldingForRecovery.exitCode === null) {
        v190HoldingForRecovery.kill("SIGKILL");
      }
      await rm(lockRoot3, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }, 60_000);

  it("actively defers when cross-version gate is unavailable, never overwrites committed files at dbPath during swap or recovery, and blocks stale open handles from writing to .bak-v190 after swap", async () => {
    // 1. Cross-version gate unavailable -> actively defer risky automatic file replacement.
    const dbPath1 = await makeTempDbPath("dw-gate-unavail-");
    const { scopeKey, walSessionId, walAssistId } =
      await seedV190WalDatabase(dbPath1);
    const db1 = new ConversationDatabase(dbPath1);
    db1.claimMainInstance("inst-gate-unavail");
    const handle1 = makeHandle(dbPath1, db1, "inst-gate-unavail");

    const deferred = await runConversationCompaction(handle1, {
      bootstrapGateMode: "unavailable",
      minDiskHeadroomBytes: 1024
    });
    expect(deferred.phase).toBe("failed");
    expect(deferred.failureCode).toBe("database_locked");
    expect(deferred.canRetry).toBe(true);
    expect(
      handle1.current().jsonNodes.inspectModelCallSnapshots().legacyCallsFound
    ).toBe(2);
    handle1.current().close();

    // 2. Uncooperative process bypasses `.storage-bootstrap` and commits a new DB at `dbPath`
    //    between `.bak-v190` rename and candidate install (`afterBackupBeforeSwap`):
    //    `installSingleFileNonOverwriting` fails with EEXIST and NEVER overwrites `dbPath`.
    const dbPath2 = await makeTempDbPath("dw-no-overwrite-swap-");
    await seedV190WalDatabase(dbPath2);
    const db2 = new ConversationDatabase(dbPath2);
    db2.claimMainInstance("inst-no-overwrite-swap");
    const handle2 = makeHandle(dbPath2, db2, "inst-no-overwrite-swap");

    const swapConflict = await runConversationCompaction(handle2, {
      minDiskHeadroomBytes: 1024,
      swapStrategy: "windows-rename",
      testHooks: {
        afterBackupBeforeSwap: ({ databasePath }) => {
          const script = `
            import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
            const jiti = createJiti(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))}, {
              interopDefault: true,
              moduleCache: false,
              alias: {
                "@deepwrite/contracts/renderer": ${JSON.stringify(join(repoRoot, "packages/contracts/src/renderer.ts"))},
                "@deepwrite/contracts": ${JSON.stringify(join(repoRoot, "packages/contracts/src/index.ts"))},
                "@deepwrite/shared/node": ${JSON.stringify(join(repoRoot, "packages/shared/src/node.ts"))},
                "@deepwrite/shared": ${JSON.stringify(join(repoRoot, "packages/shared/src/index.ts"))}
              }
            });
            const { ConversationDatabase } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))});
            const db = new ConversationDatabase(${JSON.stringify(databasePath)});
            db.claimMainInstance("uncoop-swap-writer");
            db.commit({
              key: ${JSON.stringify(scopeKey)},
              sessionId: "sess-uncoop-swap",
              batchId: "b-uncoop-swap",
              expectedRevision: 0,
              generation: 0,
              sequence: 1,
              operations: [{
                type: "putMessage",
                messageId: "msg-uncooperative-swap",
                position: 0,
                value: { id: "msg-uncooperative-swap", role: "user", content: "切换窗口内外部直建库提交" }
              }]
            });
            db.close();
          `;
          const res = spawnSync(
            process.execPath,
            ["--input-type=module", "-e", script],
            { encoding: "utf8" }
          );
          if (res.status !== 0) {
            throw new Error(`Uncooperative swap writer failed: ${res.stderr}`);
          }
        }
      }
    });
    expect(swapConflict.phase).toBe("failed");
    expect(swapConflict.failureCode).toBe("database_locked");
    expect(swapConflict.canRetry).toBe(false);
    expect(swapConflict.canRollback).toBe(true);
    expect(existsSync(`${dbPath2}.bak-v190`)).toBe(true);
    expect(
      handle2
        .current()
        .messages({ key: scopeKey, sessionId: "sess-uncoop-swap", limit: 10 })
        .messages.map((m) => m.messageId)
    ).toEqual(["msg-uncooperative-swap"]);
    handle2.current().close();

    // Backup retained cleanly with all original sessions intact.
    const backupCheck = new DatabaseSync(`${dbPath2}.bak-v190`, {
      readOnly: true
    });
    expect(backupCheck.prepare("PRAGMA quick_check").get()).toEqual({
      quick_check: "ok"
    });
    expect(
      Number(
        (
          backupCheck
            .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?")
            .get(walSessionId) as { c: number }
        ).c
      )
    ).toBe(1);
    backupCheck.close();

    // 3. Startup recovery NEVER overwrites a newly created `dbPath` either.
    const dbPath3 = await makeTempDbPath("dw-no-overwrite-recover-");
    await seedV190WalDatabase(dbPath3);
    await copyFile(dbPath3, `${dbPath3}.bak-v190`);
    await copyFile(`${dbPath3}-wal`, `${dbPath3}.bak-v190-wal`);
    await rm(dbPath3, { force: true });
    await rm(`${dbPath3}-wal`, { force: true });
    await rm(`${dbPath3}-shm`, { force: true });

    await expect(
      recoverCompactionOnStartup(dbPath3, {
        testHooks: {
          beforeRestoreBackup: ({ databasePath }) => {
            const script = `
              import { createJiti } from ${JSON.stringify(jitiModuleUrl)};
              const jiti = createJiti(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))}, {
                interopDefault: true,
                moduleCache: false,
                alias: {
                  "@deepwrite/contracts/renderer": ${JSON.stringify(join(repoRoot, "packages/contracts/src/renderer.ts"))},
                  "@deepwrite/contracts": ${JSON.stringify(join(repoRoot, "packages/contracts/src/index.ts"))},
                  "@deepwrite/shared/node": ${JSON.stringify(join(repoRoot, "packages/shared/src/node.ts"))},
                  "@deepwrite/shared": ${JSON.stringify(join(repoRoot, "packages/shared/src/index.ts"))}
                }
              });
              const { ConversationDatabase } = await jiti.import(${JSON.stringify(join(repoRoot, "apps/desktop/src/utilities/conversation-storage/database.ts"))});
              const db = new ConversationDatabase(${JSON.stringify(databasePath)});
              db.claimMainInstance("uncoop-recover-writer");
              db.commit({
                key: ${JSON.stringify(scopeKey)},
                sessionId: "sess-uncoop-recover",
                batchId: "b-uncoop-recover",
                expectedRevision: 0,
                generation: 0,
                sequence: 1,
                operations: [{
                  type: "putMessage",
                  messageId: "msg-uncooperative-recovery",
                  position: 0,
                  value: { id: "msg-uncooperative-recovery", role: "user", content: "恢复窗口内外部直建库提交" }
                }]
              });
              db.close();
            `;
            const res = spawnSync(
              process.execPath,
              ["--input-type=module", "-e", script],
              { encoding: "utf8" }
            );
            if (res.status !== 0) {
              throw new Error(
                `Uncooperative recover writer failed: ${res.stderr}`
              );
            }
          }
        }
      })
    ).rejects.toThrow();

    const verifyDb3 = new ConversationDatabase(dbPath3);
    verifyDb3.claimMainInstance("verify-recover-preserved");
    expect(
      verifyDb3
        .messages({
          key: scopeKey,
          sessionId: "sess-uncoop-recover",
          limit: 10
        })
        .messages.map((m) => m.messageId)
    ).toEqual(["msg-uncooperative-recovery"]);
    verifyDb3.close();
    expect(existsSync(`${dbPath3}.bak-v190`)).toBe(true);

    // 4. Stale pre-swap open file handle MUST NOT write into `.bak-v190` after swap
    //    across BOTH `posix-hardlink` and `windows-rename`!
    const staleStrategies =
      process.platform === "win32"
        ? (["windows-rename"] as const)
        : (["posix-hardlink", "windows-rename"] as const);
    for (const strategy of staleStrategies) {
      const dbPath4 = await makeTempDbPath(`dw-stale-fd-${strategy}-`);
      await seedV190WalDatabase(dbPath4);
      const db4 = new ConversationDatabase(dbPath4);
      db4.claimMainInstance(`inst-stale-${strategy}`);
      const handle4 = makeHandle(dbPath4, db4, `inst-stale-${strategy}`);

      let staleChild: ReturnType<typeof spawn> | undefined;
      let staleChildOut = "";
      try {
        const swapPromise = runConversationCompaction(handle4, {
          minDiskHeadroomBytes: 1024,
          swapStrategy: strategy,
          testHooks: {
            afterBackupBeforeSwap: async ({ databasePath }) => {
              // Child opens old inode while still at dbPath (for posix-hardlink, backupPath is identical inode;
              // for windows-rename, open backupPath simulating a handle held open across the rename).
              const targetInodePath =
                strategy === "posix-hardlink"
                  ? databasePath
                  : `${databasePath}.bak-v190`;
              const childScript = `
                import { DatabaseSync } from "node:sqlite";
                const db = new DatabaseSync(${JSON.stringify(targetInodePath)});
                db.exec("PRAGMA busy_timeout = 5000;");
                process.stdout.write("STALE_OPENED\\n");
                process.stdin.once("data", () => {
                  try {
                    db.exec("BEGIN IMMEDIATE; INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES ('k', 's', 'msg-stale-backup-write', 99, '{}', 2, 'user', 'bad', 0, 0, 0); COMMIT;");
                    process.stdout.write("STALE_WRITE_OK\\n");
                  } catch (e) {
                    process.stdout.write("STALE_WRITE_ERR:" + String(e.message || e) + "\\n");
                  } finally {
                    try { db.close(); } catch {}
                    process.exit(0);
                  }
                });
              `;
              staleChild = spawn(
                process.execPath,
                ["--input-type=module", "-e", childScript],
                { stdio: ["pipe", "pipe", "pipe"] }
              );
              await new Promise<void>((resolveOpened, rejectOpened) => {
                let stderr = "";
                staleChild!.stderr!.on("data", (d) => {
                  stderr += String(d);
                });
                staleChild!.stdout!.on("data", (d) => {
                  const text = String(d);
                  staleChildOut += text;
                  if (text.includes("STALE_OPENED")) resolveOpened();
                });
                staleChild!.on("exit", (c) =>
                  rejectOpened(
                    new Error(`Stale child exited early (${c}): ${stderr}`)
                  )
                );
              });
            }
          }
        });

        const compacted4 = await swapPromise;
        expect(compacted4.phase).toBe("completed_with_backup");

        // Trigger the stale open handle to attempt writing AFTER swap has completed!
        staleChild!.stdin!.write("GO\n");
        await new Promise<void>((resolveExit) => {
          staleChild!.once("exit", () => resolveExit());
        });
        expect(staleChildOut).toMatch(
          /deepwrite_compaction_backup_readonly|attempt to write a readonly database/
        );
        expect(staleChildOut).not.toContain("STALE_WRITE_OK");

        // `.bak-v190` remains healthy and unmodified (exact original 2 messages).
        const bakVerify = new DatabaseSync(`${dbPath4}.bak-v190`, {
          readOnly: true
        });
        expect(bakVerify.prepare("PRAGMA quick_check").get()).toEqual({
          quick_check: "ok"
        });
        expect(
          Number(
            (
              bakVerify.prepare("SELECT COUNT(*) AS c FROM messages").get() as {
                c: number;
              }
            ).c
          )
        ).toBe(2);
        bakVerify.close();

        // Live DB stays clean, and explicit rollback unseals restored DB so normal writes work!
        const livePage = handle4.current().messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        });
        expect(livePage.messages.map((m) => m.messageId)).toEqual([
          walAssistId
        ]);
        const rolledBack = await rollbackToCompactionBackup(handle4, {
          lockTimeoutMs: 500
        });
        expect(rolledBack.phase).toBe("rolled_back");
        const restoredPage = handle4.current().messages({
          key: scopeKey,
          sessionId: walSessionId,
          limit: 10
        });
        handle4.current().commit({
          key: scopeKey,
          sessionId: walSessionId,
          batchId: `batch-after-unseal-${strategy}`,
          expectedRevision: restoredPage.revision,
          generation: 0,
          sequence: 88,
          operations: [
            {
              type: "putMessage",
              messageId: `msg-after-unseal-${strategy}`,
              position: 1,
              value: {
                id: `msg-after-unseal-${strategy}`,
                role: "user",
                content: "回滚自动解封后恢复可写",
                createdAt: "2026-11-23T12:15:00.000Z"
              }
            }
          ]
        });
        handle4.current().close();
      } finally {
        if (staleChild && staleChild.exitCode === null) {
          staleChild.kill("SIGKILL");
        }
      }
    }
  }, 60_000);
});
