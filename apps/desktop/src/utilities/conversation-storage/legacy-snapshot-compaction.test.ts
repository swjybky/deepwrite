import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationCompactionStatus } from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";
import {
  inspectCompactionStatus,
  recoverCompactionOnStartup,
  releaseCompactionBackup,
  rollbackToCompactionBackup,
  runConversationCompaction,
  type CompactionDatabaseHandle
} from "./legacy-snapshot-compaction";
import { openConversationDatabase, Statements } from "./schema";
import { JsonNodes } from "./json-nodes";
import { INTERNAL_DIRECTORY, LOCK_FILE } from "../project-transaction/types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      for (const rel of [
        "renderer-state/conversations.sqlite.bak-v190",
        "renderer-state/conversations.sqlite.bak-v190-wal",
        "renderer-state/conversations.sqlite.bak-v190-shm"
      ]) {
        await chmod(join(root, rel), 0o600).catch(() => undefined);
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

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dw-compaction-test-"));
  tempRoots.push(root);
  return join(root, "renderer-state", "conversations.sqlite");
}

function makeHandle(
  databasePath: string,
  initialDb: ConversationDatabase,
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
      db.claimMainInstance("main_test_instance");
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

/**
 * Seeds a v1.9.0-shaped database directly using legacy container/text writes
 * so `subagentRuns[].modelCalls[].snapshot` exists in SQLite AND active WAL frames
 * sit in `-wal` before upgrade compaction begins.
 */
function seedLegacyV190Database(databasePath: string): void {
  const db = openConversationDatabase(databasePath);
  try {
    const sql = new Statements(db);
    const nodes = new JsonNodes(sql);
    const key = "conversation-history:book-long-1";
    const sessionId = "session-v190-1";

    sql
      .get(
        "INSERT INTO scopes(key, active_session_id, metadata_ref, removed, epoch, incremental) VALUES (?, ?, ?, 0, 1, 1)"
      )
      .run(
        key,
        sessionId,
        JSON.stringify(nodes.create({ bookTitle: "测试长篇", revision: 1 }))
      );

    sql
      .get(
        "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position, message_count, message_bytes, turn_count) VALUES (?, ?, 4, 1, 7, 0, ?, ?, 0, 0, 0, 0)"
      )
      .run(
        key,
        sessionId,
        JSON.stringify(
          nodes.create({
            title: "第一百五十章重写",
            checkpoints: [{ id: "ckpt-1", summary: "保留检查点摘要" }]
          })
        ),
        "2026-11-20T08:00:00.000Z"
      );

    // Helper: insert raw object/array nodes bypassing JsonNodes snapshot stripping (exact v1.9.0 behavior).
    const insertRawValue = (
      val: unknown
    ): { node: number; bytes: number; chars: number } => {
      if (val === null || typeof val !== "object") {
        if (typeof val !== "string" || val.length < 4096) {
          const encoded = JSON.stringify(val);
          return {
            node: 0,
            bytes: Buffer.byteLength(encoded),
            chars: encoded.length
          };
        }
        return nodes.create(val) as {
          node: number;
          bytes: number;
          chars: number;
        };
      }
      const id = Number(
        sql.get("INSERT INTO nodes(kind) VALUES ('pending')").run()
          .lastInsertRowid
      );
      let nodeObj: unknown;
      let bytes = 2;
      let chars = 2;
      if (Array.isArray(val)) {
        const entries = val.map((item) => {
          if (item !== null && typeof item === "object")
            return insertRawValue(item);
          if (typeof item === "string" && item.length >= 4096)
            return nodes.create(item);
          const enc = JSON.stringify(item);
          return {
            value: item,
            bytes: Buffer.byteLength(enc),
            chars: enc.length
          };
        });
        nodeObj = { kind: "array", entries };
        bytes += entries.reduce((acc, e) => acc + e.bytes + 1, 0);
        chars += entries.reduce((acc, e) => acc + e.chars + 1, 0);
      } else {
        const entries = Object.entries(val).map(([k, v]) => {
          let childRef: Record<string, unknown>;
          if (v !== null && typeof v === "object") childRef = insertRawValue(v);
          else if (typeof v === "string" && v.length >= 4096)
            childRef = nodes.create(v);
          else {
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
        .run(
          Array.isArray(val) ? "array" : "object",
          JSON.stringify(nodeObj),
          id
        );
      return { node: id, bytes, chars };
    };

    const userRef = nodes.create({
      id: "msg-user-1",
      role: "user",
      content: "请审校第150章。",
      createdAt: "2026-11-20T08:00:00.000Z"
    });
    sql
      .get(
        "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, 0, ?, ?, 'user', ?, 0, 0, 0)"
      )
      .run(
        key,
        sessionId,
        "msg-user-1",
        JSON.stringify(userRef),
        userRef.bytes,
        "请审校第150章。"
      );

    function makeUncompressibleProse(
      seed: number,
      targetChars: number
    ): string {
      const vocab =
        "雾港钟楼夜雨石板街道灯影回声潮汐码头渡轮甲板长风星辰山脉荒原古城书阁墨迹竹简灯火窗棂微光残页";
      const chars: string[] = [];
      let state = seed >>> 0;
      for (let i = 0; i < targetChars; i += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const ch = vocab[(state >>> 24) % vocab.length]!;
        chars.push(ch);
        if (i % 24 === 23) chars.push("，");
        if (i % 96 === 95) chars.push("。\n");
      }
      return chars.join("");
    }

    const bigPrompt = makeUncompressibleProse(101, 60_000);
    const bigMessages = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `轮次${i}：${makeUncompressibleProse(202 + i * 37, 25_000)}`
    }));

    const assistantRef = insertRawValue({
      id: "msg-assistant-1",
      role: "assistant",
      content: "审校完成，已形成修改建议。",
      createdAt: "2026-11-20T08:01:00.000Z",
      toolCalls: [
        {
          id: "tc-1",
          name: "spawn_subagent",
          status: "completed",
          summary: "并行审校完成"
        }
      ],
      editProposals: [
        {
          id: "prop-1",
          targetId: "chapter_150",
          title: "第一百五十章修订",
          status: "applied",
          toolCallIds: ["tc-1"],
          hunks: [
            {
              id: "hunk-1",
              lines: [
                { type: "context", text: "第一段原文。" },
                { type: "remove", text: "旧句子。" },
                { type: "add", text: "润色后的新句子。" }
              ]
            }
          ],
          discardSnapshot: {
            beforeText: "第一段原文。\n旧句子。",
            afterText: "第一段原文。\n润色后的新句子。"
          }
        }
      ],
      subagentRuns: [
        {
          subagentRunId: "sub-1",
          subagentId: "style_reviewer",
          name: "文风审校",
          status: "completed",
          task: "检查第150章",
          output: "输出结论。",
          toolCalls: [{ id: "stc-1", name: "read", status: "completed" }],
          processingSteps: [
            { id: "st-1", type: "response", content: "输出结论。" }
          ],
          modelCalls: [
            {
              requestId: "req-v190-1",
              sequence: 1,
              requestedProvider: "openai",
              requestedModel: "gpt-4o",
              responseModel: null,
              responseModelEvidence: "unknown",
              startedAt: "2026-11-20T08:00:10.000Z",
              endedAt: "2026-11-20T08:00:12.000Z",
              durationMs: 2000,
              status: "completed",
              snapshot: {
                systemPrompt: bigPrompt,
                messages: bigMessages,
                tools: [{ name: "read", schema: bigPrompt.slice(0, 12000) }],
                providerInput: {
                  messages: bigMessages,
                  system: bigPrompt
                }
              }
            }
          ]
        }
      ]
    });

    sql
      .get(
        "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, 1, ?, ?, 'assistant', ?, 0, 0, 0)"
      )
      .run(
        key,
        sessionId,
        "msg-assistant-1",
        JSON.stringify(assistantRef),
        assistantRef.bytes,
        "审校完成，已形成修改建议。"
      );

    // Intentionally leave WAL frames uncheckpointed to simulate active v1.9.0 -wal data.
  } finally {
    db.close();
  }
}

describe("legacy snapshot compaction and WAL management", () => {
  it("marks brand-new databases as skipped_new and returns immediately on compact", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-1");
    const status = await inspectCompactionStatus(db);
    expect(status.phase).toBe("skipped_new");
    expect(status.legacyCallsFound).toBe(0);

    const handle = makeHandle(dbPath, db);
    const compacted = await runConversationCompaction(handle);
    expect(compacted.phase).toBe("skipped_new");
    handle.current().close();
  });

  it("compacts v1.9.0 bloated DB with active WAL, preserves all fidelity, and releases backup for net savings", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    seedLegacyV190Database(dbPath);

    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-1");
    const initial = await inspectCompactionStatus(db);
    expect(initial.phase).toBe("needed");
    expect(initial.legacyCallsFound).toBe(1);
    expect(initial.estimatedReclaimableBytes).toBeGreaterThan(100_000);

    const progress: ConversationCompactionStatus[] = [];
    const handle = makeHandle(dbPath, db, progress);
    const compacted = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(compacted.phase).toBe("completed_with_backup");
    expect(compacted.legacyCallsFound).toBe(0);
    expect(compacted.bytesAfter).toBeLessThan(compacted.bytesBefore);
    expect(compacted.backupBytes).toBeGreaterThan(0);
    expect(compacted.canReleaseBackup).toBe(true);
    expect(compacted.canRollback).toBe(true);
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining([
        "running",
        "verifying",
        "swapping",
        "completed_with_backup"
      ])
    );

    // Verify full conversation, editProposals, toolCalls, and checkpoint fidelity.
    const liveDb = handle.current();
    const loadedMessages = liveDb.messages({
      key: "conversation-history:book-long-1",
      sessionId: "session-v190-1",
      limit: 10
    });
    expect(loadedMessages.messages).toHaveLength(2);
    const detail = liveDb.detail({
      key: "conversation-history:book-long-1",
      sessionId: "session-v190-1",
      messageId: "msg-assistant-1",
      expectedRevision: loadedMessages.revision,
      path: []
    });
    const parsedMsg = JSON.parse(detail.chunk) as {
      editProposals: {
        id: string;
        hunks: { id: string }[];
        discardSnapshot: { beforeText: string };
      }[];
      toolCalls: { id: string }[];
      subagentRuns: {
        subagentRunId: string;
        modelCalls: { requestId: string; status: string; snapshot?: unknown }[];
      }[];
    };
    expect(parsedMsg.toolCalls).toHaveLength(1);
    expect(parsedMsg.editProposals[0]?.hunks[0]?.id).toBe("hunk-1");
    expect(parsedMsg.editProposals[0]?.discardSnapshot.beforeText).toBe(
      "第一段原文。\n旧句子。"
    );
    expect(parsedMsg.subagentRuns[0]?.modelCalls[0]?.requestId).toBe(
      "req-v190-1"
    );
    expect(parsedMsg.subagentRuns[0]?.modelCalls[0]?.status).toBe("completed");
    expect(parsedMsg.subagentRuns[0]?.modelCalls[0]?.snapshot).toBeUndefined();

    // Idempotency: calling compactConversations again does no work.
    const repeat = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(repeat.phase).toBe("completed_with_backup");

    // Releasing backup deletes `.bak-v190*` and records net positive space freed.
    const released = await releaseCompactionBackup(handle);
    expect(released.phase).toBe("backup_released");
    expect(released.canReleaseBackup).toBe(false);
    expect(released.canRollback).toBe(false);
    expect(released.netFreedBytes).toBeGreaterThan(100_000);
    const filesAfter = await readdir(dirname(dbPath));
    expect(filesAfter.some((f) => f.includes(".bak-v190"))).toBe(false);

    // Repeating compact after release remains a no-op.
    const postRelease = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(postRelease.phase).toBe("backup_released");
    handle.current().close();
  });

  it("handles disk_full and lock conflicts safely and retries cleanly once cleared", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    seedLegacyV190Database(dbPath);
    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-1");
    const handle = makeHandle(dbPath, db);

    // Low disk space fails safely with disk_full without touching DB.
    const diskFail = await runConversationCompaction(handle, {
      getAvailableDiskBytes: async () => 512 * 1024
    });
    expect(diskFail.phase).toBe("failed");
    expect(diskFail.failureCode).toBe("disk_full");
    expect(diskFail.canRetry).toBe(true);
    expect(handle.blockedReason()).toBeUndefined();

    // Active lock file from another alive PID triggers old_process_active quickly.
    const lockDir = join(await Promise.resolve(dirname(dbPath)));
    await mkdir(join(lockDir, INTERNAL_DIRECTORY), { recursive: true });
    await writeFile(
      join(lockDir, INTERNAL_DIRECTORY, LOCK_FILE),
      JSON.stringify({
        pid: process.ppid,
        token: "abcdef01",
        acquiredAt: new Date().toISOString()
      }) + "\n"
    );
    const lockFail = await runConversationCompaction(handle, {
      lockTimeoutMs: 50,
      minDiskHeadroomBytes: 1024
    });
    expect(lockFail.phase).toBe("failed");
    expect(lockFail.failureCode).toBe("old_process_active");
    expect(lockFail.canRetry).toBe(true);
    await rm(join(lockDir, INTERNAL_DIRECTORY, LOCK_FILE), { force: true });

    // Retry succeeds after disk & lock conditions clear.
    const retried = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(retried.phase).toBe("completed_with_backup");
    handle.current().close();
  });

  it("recovers cleanly from interrupted swap and protects post-backup conversations from rollback", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    seedLegacyV190Database(dbPath);
    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-1");
    const handle = makeHandle(dbPath, db);

    // Fault right after backup move -> automatic rollback restores original DB.
    const swapFailed = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024,
      testHooks: {
        afterBackupBeforeSwap: () => {
          throw new Error("Simulated power loss during swap");
        }
      }
    });
    expect(swapFailed.phase).toBe("failed");
    expect(swapFailed.failureCode).toBe("swap_failed");
    expect(
      handle.current().jsonNodes.inspectModelCallSnapshots().legacyCallsFound
    ).toBe(1);

    // Retry completes cleanly.
    const compacted = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(compacted.phase).toBe("completed_with_backup");

    // Simulate startup recovery cleaning orphan candidate temps and restoring missing main DB from backup.
    await writeFile(`${dbPath}.candidate-orphan.tmp`, "orphan");
    handle.closeDatabase();
    await rm(dbPath, { force: true });
    await recoverCompactionOnStartup(dbPath);
    const filesRestored = await readdir(dirname(dbPath));
    expect(filesRestored.some((f) => f.includes(".candidate-"))).toBe(false);
    const reopened = handle.reopenDatabase();
    expect(
      reopened.jsonNodes.inspectModelCallSnapshots().legacyCallsFound
    ).toBe(1);

    // Re-compact, write a NEW message afterwards, and assert rollback refuses silent overwrite.
    const reCompacted = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(reCompacted.phase).toBe("completed_with_backup");

    handle.current().commit({
      key: "conversation-history:book-long-1",
      sessionId: "session-new-post-backup",
      batchId: "batch-new-1",
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-post-backup",
          position: 0,
          value: {
            id: "msg-post-backup",
            role: "user",
            content: "备份之后新建的对话不可丢失！"
          }
        }
      ]
    });

    const rollbackRefused = await rollbackToCompactionBackup(handle, {
      lockTimeoutMs: 500
    });
    expect(rollbackRefused.failureCode).toBe("post_backup_changes_present");
    expect(rollbackRefused.canRollback).toBe(false);
    expect(
      handle.current().session({
        key: "conversation-history:book-long-1",
        sessionId: "session-new-post-backup"
      })
    ).not.toBeNull();

    handle.current().close();
  });

  it("truncates large WAL when threshold is exceeded and on close", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-1");
    const bigText = "大章节正文".repeat(12000);
    db.commit({
      key: "conversation-history:wal-test",
      sessionId: "s-wal",
      batchId: "b-1",
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      operations: [
        {
          type: "putMessage",
          messageId: "m-1",
          position: 0,
          value: { id: "m-1", role: "user", content: bigText }
        }
      ]
    });
    const walBefore = (await stat(`${dbPath}-wal`)).size;
    expect(walBefore).toBeGreaterThan(16 * 1024);
    db.checkpoint(16 * 1024);
    const walAfter = (await stat(`${dbPath}-wal`).catch(() => ({ size: 0 })))
      .size;
    expect(walAfter).toBe(0);
    db.close();
  });

  it("fast-exits recoverCompactionOnStartup without touching the bootstrap gate when no compaction artifacts exist", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    seedLegacyV190Database(dbPath);

    await expect(
      recoverCompactionOnStartup(dbPath, {
        bootstrapGateMode: "unavailable"
      })
    ).resolves.toBeUndefined();

    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-fast-exit");
    expect(
      db.messages({
        key: "conversation-history:book-long-1",
        sessionId: "session-v190-1",
        limit: 10
      }).messages
    ).toHaveLength(2);
    db.close();
  });

  it("yields cleanly to user writes mid-build without recording failure and completes on subsequent retry", async () => {
    const dbPath = await makeTempDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    seedLegacyV190Database(dbPath);
    const db = new ConversationDatabase(dbPath);
    db.claimMainInstance("inst-yield");
    const progress: ConversationCompactionStatus[] = [];
    const handle = makeHandle(dbPath, db, progress);

    let aborted = false;
    const preempted = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024,
      shouldAbort: () => aborted,
      testHooks: {
        duringCandidateBuild: () => {
          aborted = true;
        }
      }
    });

    expect(preempted.phase).toBe("needed");
    expect(preempted.failureCode).toBeUndefined();
    expect(handle.blockedReason()).toBeUndefined();
    expect(progress.some((item) => item.phase === "failed")).toBe(false);

    const filesAfterAbort = await readdir(dirname(dbPath));
    expect(filesAfterAbort.some((f) => f.includes(".candidate-"))).toBe(false);
    const storedMeta = handle
      .current()
      .statements.get("SELECT value FROM runtime_meta WHERE key = ?")
      .get("legacy_model_call_compaction_v1");
    expect(storedMeta).toBeUndefined();

    const beforeCommit = handle.current().messages({
      key: "conversation-history:book-long-1",
      sessionId: "session-v190-1",
      limit: 10
    });
    const receipt = handle.current().commit({
      key: "conversation-history:book-long-1",
      sessionId: "session-v190-1",
      batchId: "batch-after-preempt",
      expectedRevision: beforeCommit.revision,
      generation: beforeCommit.generation,
      sequence: 8,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-user-2",
          position: 2,
          value: {
            id: "msg-user-2",
            role: "user",
            content: "让路后的即时提交"
          }
        }
      ]
    });
    expect(receipt.revision).toBe(beforeCommit.revision + 1);

    const retried = await runConversationCompaction(handle, {
      minDiskHeadroomBytes: 1024
    });
    expect(retried.phase).toBe("completed_with_backup");
    expect(retried.legacyCallsFound).toBe(0);
    const finalMsgs = handle.current().messages({
      key: "conversation-history:book-long-1",
      sessionId: "session-v190-1",
      limit: 10
    });
    expect(finalMsgs.messages.map((m) => m.messageId)).toEqual([
      "msg-user-1",
      "msg-assistant-1",
      "msg-user-2"
    ]);
    handle.current().close();
  });
});
