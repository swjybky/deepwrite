import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { build } from "vite";
import { ConversationStorageWorker } from "./worker-client";
import { openConversationDatabase, Statements } from "./schema";

let directory: string;
const clients: ConversationStorageWorker[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "deepwrite-storage-worker-test-"));
  await mkdir(join(directory, "renderer-state"));
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: join(dirname(fileURLToPath(import.meta.url)), "worker-entry.ts"),
      outDir: directory,
      emptyOutDir: false,
      rollupOptions: { output: { entryFileNames: "worker.mjs" } }
    },
    ssr: { noExternal: true }
  });
});
afterEach(async () => {
  await Promise.all(
    clients.splice(0).map((client) => client.close().catch(() => {}))
  );
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
function client(name: string, legacyStatePath?: string) {
  const worker = new ConversationStorageWorker(
    join(directory, "renderer-state", `${name}.sqlite`),
    join(directory, "worker.mjs"),
    legacyStatePath
  );
  clients.push(worker);
  return worker;
}

describe("Core-owned conversation worker", () => {
  it("preserves the actual SQLite startup cause and writes a safe diagnostic instead of a generic request error", async () => {
    await writeFile(
      join(directory, "renderer-state", "corrupt.sqlite"),
      "INVALID_FIXTURE_SQLITE_BYTES"
    );
    const worker = client("corrupt");
    await expect(
      worker.list({ key: "conversation-history:fixture" })
    ).rejects.toMatchObject({
      code: "database_corrupt",
      phase: "database-open",
      nativeCode: "ERR_SQLITE_ERROR",
      sqliteCode: 26
    });
    const log = await readFile(
      join(directory, "diagnostics", "conversation-storage.log"),
      "utf8"
    );
    expect(log).toContain('"sqliteCode":26');
    expect(log).toContain('"phase":"database-open"');
    expect(log).not.toContain("INVALID_FIXTURE_SQLITE_BYTES");
    expect(log).not.toContain('"message"');
    expect(log).not.toContain('"stack"');
  });

  it("waits for legacy migration, preserves the source, commits incrementally and recovers after restart", async () => {
    vi.stubEnv("DEEPWRITE_MAIN_INSTANCE_ID", "fixture-worker-main");
    const source = join(directory, "legacy.json");
    await writeFile(
      source,
      JSON.stringify({
        version: 1,
        entries: {
          "conversation-history:fixture": {
            version: 1,
            activeSessionId: "session",
            conversations: [
              {
                sessionId: "session",
                messages: [{ id: "message", role: "user", content: "原始内容" }]
              }
            ]
          }
        }
      })
    );
    const first = client("migrated", source);
    const query = { key: "conversation-history:fixture", sessionId: "session" };
    expect((await first.messages(query)).messages[0]?.value.content).toBe(
      "原始内容"
    );
    const batch = {
      ...query,
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      batchId: "append",
      operations: [
        {
          type: "patchMessage" as const,
          messageId: "message",
          changes: [{ op: "append" as const, path: ["content"], text: "追加" }]
        }
      ]
    };
    const receipt = await first.commit(batch);
    await first.close();
    const second = client("migrated", source);
    expect(await second.commit(batch)).toEqual(receipt);
    expect((await second.messages(query)).messages[0]?.value.content).toBe(
      "原始内容追加"
    );
    await second.legacySave("conversation-preferences:fixture", {
      modelId: "fixture-model"
    });
    expect(await second.legacyLoad("conversation-preferences:fixture")).toEqual(
      { modelId: "fixture-model" }
    );
    await expect(second.legacySave(query.key, {})).rejects.toThrow(
      "incremental"
    );
    const merged = await second.mergeScopes({
      key: "conversation-history:canonical",
      sources: [query.key]
    });
    expect(merged.mergedSources).toEqual([query.key]);
    expect(
      (
        await second.messages({
          ...query,
          key: "conversation-history:canonical"
        })
      ).messages[0]?.value.content
    ).toBe("原始内容追加");
    expect((await second.list({ key: query.key })).sessions).toEqual([]);
  });

  it("bounds simultaneous requests, retains explicit backpressure and permits later requests", async () => {
    const worker = client("bounded");
    const requests = Array.from({ length: 64 }, () =>
      worker.list({ key: "conversation-history:fixture" })
    );
    const results = await Promise.allSettled(requests);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(32);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(32);
    expect(
      rejected.every(
        (result) =>
          result.status === "rejected" && result.reason.code === "queue_full"
      )
    ).toBe(true);
    expect(
      (await worker.list({ key: "conversation-history:fixture" })).sessions
    ).toEqual([]);
  });

  it("preempts background compaction cleanly when a user commit arrives in the worker", async () => {
    vi.stubEnv("DEEPWRITE_MAIN_INSTANCE_ID", "fixture-worker-preempt");
    const dbPath = join(directory, "renderer-state", "preempt.sqlite");
    const scopeKey = "conversation-history:preempt-fixture";
    const sessionId = "session-preempt";

    const seedDb = openConversationDatabase(dbPath);
    try {
      const sql = new Statements(seedDb);
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
      const insertRaw = (
        val: unknown
      ):
        | {
            value: string | number | boolean | null;
            bytes: number;
            chars: number;
          }
        | { node: number; bytes: number; chars: number } => {
        if (val === null || typeof val !== "object") {
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
        const entries = Object.entries(val).map(([k, v]) => [k, insertRaw(v)]);
        sql
          .get("UPDATE nodes SET kind = 'object', value = ? WHERE id = ?")
          .run(JSON.stringify({ kind: "object", entries }), id);
        return {
          node: id,
          bytes: entries.reduce(
            (a, [k, v]) =>
              a +
              Buffer.byteLength(JSON.stringify(k)) +
              2 +
              (v as { bytes: number }).bytes,
            2
          ),
          chars: entries.reduce(
            (a, [k, v]) =>
              a + JSON.stringify(k).length + 2 + (v as { chars: number }).chars,
            2
          )
        };
      };
      const msgStmt = sql.get(
        "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, ?, ?, ?, 'assistant', '旧版回复', 0, 0, 0)"
      );
      const payloadText = "旧快照填充".repeat(200);
      seedDb.exec("BEGIN IMMEDIATE");
      for (let i = 0; i < 150; i += 1) {
        const ref = insertRaw({
          id: `msg-legacy-${i}`,
          role: "assistant",
          content: `旧版回复-${i}`,
          subagentRuns: [
            {
              subagentRunId: `sr-${i}`,
              subagentId: "reviewer",
              name: "审校",
              status: "completed",
              modelCalls: [
                {
                  requestId: `req-${i}`,
                  sequence: 1,
                  status: "completed",
                  snapshot: { systemPrompt: payloadText }
                }
              ]
            }
          ]
        });
        msgStmt.run(
          scopeKey,
          sessionId,
          `msg-legacy-${i}`,
          i,
          JSON.stringify(ref),
          ref.bytes
        );
      }
      seedDb.exec("COMMIT");
    } finally {
      seedDb.close();
    }

    const worker = client("preempt");
    const initialStatus = await worker.compactionStatus();
    expect(initialStatus.phase).toBe("needed");
    expect(initialStatus.legacyCallsFound).toBe(150);

    const compacting = worker.compactConversations();
    const committing = worker.commit({
      key: scopeKey,
      sessionId,
      batchId: "batch-concurrent-write",
      expectedRevision: 1,
      generation: 0,
      sequence: 2,
      operations: [
        {
          type: "putMessage",
          messageId: "msg-user-concurrent",
          position: 150,
          value: {
            id: "msg-user-concurrent",
            role: "user",
            content: "并发写消息必须成功"
          }
        }
      ]
    });

    const [compactResult, commitResult] = await Promise.all([
      compacting,
      committing
    ]);
    expect(commitResult.revision).toBe(2);
    expect(["needed", "completed_with_backup"]).toContain(compactResult.phase);

    const finalized =
      compactResult.phase === "needed"
        ? await worker.compactConversations()
        : compactResult;
    expect(finalized.phase).toBe("completed_with_backup");
    expect(finalized.legacyCallsFound).toBe(0);

    const session = await worker.session({ key: scopeKey, sessionId });
    expect(session?.messageCount).toBe(151);
    const tail = await worker.messages({
      key: scopeKey,
      sessionId,
      direction: "backward",
      limit: 5
    });
    expect(tail.messages.at(-1)?.messageId).toBe("msg-user-concurrent");
  });
});
