import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./database";
import { LegacyConversationStore } from "./legacy-store";
import { JsonNodes } from "./json-nodes";
import { TextChunks } from "./text-chunks";

const databases: ConversationDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => database.close());
});
const key = "conversation-history:canonical";
const source = "conversation-history:stage";
function setup() {
  const database = new ConversationDatabase(":memory:");
  databases.push(database);
  return { database, legacy: new LegacyConversationStore(database.database) };
}
function record(sessionId: string, date: string, content: string) {
  return {
    sessionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: date,
    draft: "",
    unknown: { session: "完整保留" },
    messages: [
      {
        id: `message-${sessionId}`,
        role: "assistant",
        content,
        status: "complete",
        editProposals: [
          {
            status: "pending",
            discardSnapshot: { before: "虚构撤销正文", future: [1, true] }
          }
        ],
        unknown: { message: "完整保留" }
      }
    ]
  };
}
function history(...conversations: ReturnType<typeof record>[]) {
  return {
    version: 1,
    activeSessionId: conversations[0]?.sessionId ?? "",
    conversations
  };
}

describe("reference-preserving scope consolidation", () => {
  it("moves newer records and pending proposals without decompressing bodies, preserves unknown fields and retains losing owners", () => {
    const { database, legacy } = setup();
    const before = record(
      "shared",
      "2026-01-01T00:00:00.000Z",
      "旧正文".repeat(20000)
    );
    const newer = record(
      "shared",
      "2026-02-01T00:00:00.000Z",
      "新正文".repeat(20000)
    );
    const unique = record("unique", "2026-03-01T00:00:00.000Z", "来源独有");
    legacy.save(key, { ...history(before), targetUnknown: { retained: true } });
    legacy.save(source, {
      ...history(newer, unique),
      sourceUnknown: { retained: "来源" }
    });
    const previous = database.session({ key, sessionId: "shared" })!;
    const read = vi.spyOn(JsonNodes.prototype, "read");
    const range = vi.spyOn(TextChunks.prototype, "readRange");
    const nodeCount = database.database
      .prepare("SELECT COUNT(*) AS count FROM nodes")
      .get()!.count;
    const chunkCount = database.database
      .prepare("SELECT COUNT(*) AS count FROM chunks")
      .get()!.count;
    expect(database.mergeScopes({ key, sources: [source] })).toEqual({
      mergedSources: [source],
      activeSessionId: "shared"
    });
    expect(read).not.toHaveBeenCalled();
    expect(range).not.toHaveBeenCalled();
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM nodes").get()!
        .count
    ).toBe(nodeCount);
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM chunks").get()!
        .count
    ).toBe(chunkCount);
    const state = database.session({ key, sessionId: "shared" })!;
    expect(state.revision).toBeGreaterThan(previous.revision);
    expect(state.generation).toBeGreaterThan(previous.generation);
    const value = legacy.load(key) as ReturnType<typeof history> & {
      sourceUnknown: unknown;
      targetUnknown: unknown;
    };
    expect(
      value.conversations.find((item) => item.sessionId === "shared")
    ).toEqual(newer);
    expect(value.sourceUnknown).toEqual({ retained: "来源" });
    expect(value.targetUnknown).toEqual({ retained: true });
    const backup = database.database
      .prepare(
        "SELECT scope_key FROM sessions WHERE scope_key LIKE 'conversation-backup:%'"
      )
      .get()!;
    const backupRoot = database.database
      .prepare("SELECT value_ref FROM messages WHERE scope_key = ?")
      .get(String(backup.scope_key))!;
    const newRoot = database.database
      .prepare(
        "SELECT value_ref FROM messages WHERE scope_key = ? AND session_id = 'shared'"
      )
      .get(key)!;
    expect(JSON.parse(String(newRoot.value_ref)).node).not.toBe(
      JSON.parse(String(backupRoot.value_ref)).node
    );
    database.commit({
      key,
      sessionId: "shared",
      batchId: "after-merge",
      expectedRevision: state.revision,
      generation: state.generation,
      sequence: state.sequence + 1,
      operations: [
        {
          type: "patchMessage",
          messageId: "message-shared",
          changes: [{ op: "set", path: ["content"], value: "迁移后新修改" }]
        }
      ]
    });
    expect(
      database.database
        .prepare("SELECT value_ref FROM messages WHERE scope_key = ?")
        .get(String(backup.scope_key))!.value_ref
    ).toBe(backupRoot.value_ref);
    expect(database.session({ key: source, sessionId: "unique" })).toBeNull();
    expect(
      database.list({ key: source, includeDeleted: true }).sessions
    ).toEqual([]);
    expect(legacy.load(source)).toBeUndefined();
    expect(database.mergeScopes({ key, sources: [source] })).toEqual({
      mergedSources: [],
      activeSessionId: "shared"
    });
    expect(database.database.prepare("PRAGMA foreign_key_check").all()).toEqual(
      []
    );
  });

  it("keeps acknowledged target updates and deletions ahead of newer source snapshots and fences removed writers", () => {
    const { database, legacy } = setup();
    legacy.save(
      key,
      history(
        record("current", "2026-01-01", "当前"),
        record("deleted", "2026-01-01", "已删除")
      )
    );
    legacy.save(
      source,
      history(
        record("current", "2026-05-01", "旧来源时间更晚"),
        record("deleted", "2026-05-01", "不能复活"),
        record("source-deleted", "2026-05-01", "来源软删除")
      )
    );
    for (const [scope, sessionId, remove] of [
      [key, "current", false],
      [key, "deleted", true],
      [source, "source-deleted", true]
    ] as const) {
      const state = database.session({ key: scope, sessionId })!;
      database.commit({
        key: scope,
        sessionId,
        batchId: "change",
        expectedRevision: state.revision,
        generation: state.generation,
        sequence: 1,
        operations: remove
          ? [
              {
                type: "patchMessage",
                messageId: `message-${sessionId}`,
                changes: [{ op: "set", path: ["editProposals"], value: [] }]
              },
              { type: "setDeleted", deleted: true }
            ]
          : [
              {
                type: "patchMessage",
                messageId: `message-${sessionId}`,
                changes: [{ op: "append", path: ["content"], text: "新确认" }]
              }
            ]
      });
    }
    database.mergeScopes({ key, sources: [source] });
    expect(
      database.messages({ key, sessionId: "current" }).messages[0]!.value
        .content
    ).toBe("当前新确认");
    expect(database.session({ key, sessionId: "deleted" })?.deleted).toBe(true);
    expect(
      database.session({ key, sessionId: "source-deleted" })?.deleted
    ).toBe(true);
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE scope_key = ?")
        .get(source)!.count
    ).toBe(2);
    expect(() =>
      database.commit({
        key: source,
        sessionId: "delayed",
        batchId: "stale",
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        operations: [{ type: "setMetadata", value: {} }]
      })
    ).toThrow("removed");
    expect(() =>
      database.stage({
        key: source,
        sessionId: "delayed",
        stageId: "stale",
        messageId: "message",
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        chunkId: "first",
        value: {}
      })
    ).toThrow("removed");
  });

  it("rolls back all moved references and source tombstones when the final source update fails", () => {
    const { database, legacy } = setup();
    const first = history(record("first", "2026-01-01", "第一来源"));
    const second = history(record("second", "2026-02-01", "第二来源"));
    const other = "conversation-history:other";
    legacy.save(source, first);
    legacy.save(other, second);
    database.database.exec(
      "CREATE TRIGGER fail_scope_merge BEFORE UPDATE OF removed ON scopes WHEN NEW.key = 'conversation-history:other' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
    );
    expect(() =>
      database.mergeScopes({ key, sources: [source, other] })
    ).toThrow("fixture failure");
    expect(legacy.load(source)).toEqual(first);
    expect(legacy.load(other)).toEqual(second);
    expect(database.list({ key }).sessions).toEqual([]);
    expect(database.database.prepare("PRAGMA foreign_key_check").all()).toEqual(
      []
    );
  });

  it("compares incoming sources by timestamp even when the first incoming record had incremental writes", () => {
    const { database, legacy } = setup();
    const other = "conversation-history:later-stage";
    legacy.save(source, history(record("shared", "2026-01-01", "第一来源")));
    legacy.save(other, history(record("shared", "2026-02-01", "较新来源")));
    const state = database.session({ key: source, sessionId: "shared" })!;
    database.commit({
      key: source,
      sessionId: "shared",
      expectedRevision: state.revision,
      generation: state.generation,
      sequence: 1,
      batchId: "source-acknowledged",
      operations: [
        { type: "setMetadata", value: { draft: "第一来源的旧确认草稿" } }
      ]
    });
    database.mergeScopes({ key, sources: [source, other] });
    expect(
      database.messages({ key, sessionId: "shared" }).messages[0]!.value.content
    ).toBe("较新来源");
  });

  it.each(["streaming", "accepting", "discarding"])(
    "rejects %s work without hiding the source",
    (status) => {
      const { database, legacy } = setup();
      const value = record("session", "2026-01-01", "活动中");
      const message = value.messages[0]!;
      if (status === "streaming") message.status = "streaming";
      else if (status === "accepting")
        message.editProposals[0]!.status = "accepting";
      else
        Object.assign(message.editProposals[0]!, {
          discardState: { status: "discarding" }
        });
      legacy.save(source, history(value));
      expect(() => database.mergeScopes({ key, sources: [source] })).toThrow(
        "in-progress"
      );
      expect(legacy.listHistoryKeys()).toContain(source);
    }
  );
});
