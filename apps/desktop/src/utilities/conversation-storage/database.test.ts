import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationHistoryBatch,
  ConversationHistoryJson
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";
import { JsonNodes } from "./json-nodes";

const roots: string[] = [];
const databases: ConversationDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      /* Already closed by restart test. */
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function open() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-conversation-db-"));
  roots.push(root);
  const path = join(root, "history.sqlite");
  const database = new ConversationDatabase(path);
  databases.push(database);
  return { database, path };
}
function batch(
  overrides: Partial<ConversationHistoryBatch> = {}
): ConversationHistoryBatch {
  return {
    key: "conversation-history:fixture",
    sessionId: "session-1",
    batchId: "batch-1",
    expectedRevision: 0,
    generation: 0,
    sequence: 1,
    operations: [
      {
        type: "putMessage",
        messageId: "message-1",
        position: 0,
        value: { id: "message-1", role: "user", content: "虚构测试内容" }
      }
    ],
    ...overrides
  };
}
function full(
  database: ConversationDatabase,
  messageId = "message-1",
  revision = 1
): ConversationHistoryJson {
  let offset = 0;
  let text = "";
  for (;;) {
    const detail = database.detail({
      key: "conversation-history:fixture",
      sessionId: "session-1",
      messageId,
      path: [],
      expectedRevision: revision,
      offset,
      maxBytes: 1024
    });
    expect(Buffer.byteLength(detail.chunk)).toBeLessThanOrEqual(1024);
    text += detail.chunk;
    if (detail.nextOffset === null)
      return JSON.parse(text) as ConversationHistoryJson;
    expect(detail.nextOffset).toBeGreaterThan(offset);
    offset = detail.nextOffset;
  }
}

describe("ConversationDatabase durability and isolation", () => {
  it("preserves unknown JSON fields, raw tool text, proposal undo state and Unicode through bounded reads and restart", async () => {
    const { database, path } = await open();
    const message = JSON.parse(
      '{"id":"message-1","role":"assistant","__proto__":{"retained":true}}'
    ) as Record<string, ConversationHistoryJson>;
    Object.assign(message, {
      content: '中文😀\\\n"'.repeat(12_000) + "\ud800",
      thinking: "思考内容".repeat(3000),
      toolCalls: [
        { id: "tool-1", args: { a: 1 }, argumentsText: '{ "a" : 1 }' }
      ],
      editProposals: [
        {
          id: "proposal-1",
          status: "accepted",
          discardSnapshot: { beforeText: "完整原文".repeat(3000) }
        }
      ],
      futureField: [null, 5, true, { nested: "保留" }]
    });
    database.commit(
      batch({
        operations: [
          {
            type: "putMessage",
            messageId: "message-1",
            position: 0,
            value: message
          }
        ]
      })
    );
    expect(full(database)).toEqual(message);
    const projected = database.messages({
      key: "conversation-history:fixture",
      sessionId: "session-1",
      maxBytes: 4096
    });
    expect(projected.messages[0]?.details.map((ref) => ref.path[0])).toContain(
      "editProposals"
    );
    database.close();
    const reopened = new ConversationDatabase(path);
    databases.push(reopened);
    expect(full(reopened)).toEqual(message);
    expect(
      reopened.database.prepare("PRAGMA synchronous").get()?.synchronous
    ).toBe(2);
    expect(
      reopened.database.prepare("PRAGMA journal_mode").get()?.journal_mode
    ).toBe("wal");
  });

  it("acknowledges an identical batch after restart and rejects stale revisions or sequences", async () => {
    const { database, path } = await open();
    const request = batch();
    const receipt = database.commit(request);
    database.close();
    const reopened = new ConversationDatabase(path);
    databases.push(reopened);
    expect(reopened.commit(request)).toEqual(receipt);
    expect(
      reopened.session({ key: request.key, sessionId: request.sessionId })
        ?.messageCount
    ).toBe(1);
    expect(() => reopened.commit(batch({ batchId: "different" }))).toThrow(
      "changed"
    );
    expect(() =>
      reopened.commit(batch({ batchId: "different", expectedRevision: 1 }))
    ).toThrow("order");
  });

  it("rolls back all earlier operations and newly allocated content when a later operation fails", async () => {
    const { database } = await open();
    database.commit(batch());
    const nodeCount = database.database
      .prepare("SELECT COUNT(*) AS count FROM nodes")
      .get()?.count;
    expect(() =>
      database.commit(
        batch({
          batchId: "failed",
          sequence: 2,
          expectedRevision: 1,
          operations: [
            {
              type: "patchMessage",
              messageId: "message-1",
              changes: [
                { op: "set", path: ["content"], value: "新内容".repeat(5000) }
              ]
            },
            {
              type: "patchMessage",
              messageId: "missing",
              changes: [{ op: "append", path: ["content"], text: "失败" }]
            }
          ]
        })
      )
    ).toThrow("no longer exists");
    expect(full(database)).toEqual({
      id: "message-1",
      role: "user",
      content: "虚构测试内容"
    });
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM nodes").get()
        ?.count
    ).toBe(nodeCount);
    expect(
      database.session({
        key: "conversation-history:fixture",
        sessionId: "session-1"
      })?.revision
    ).toBe(1);
  });

  it("uses deletion generations to prevent old queued saves from resurrecting a session", async () => {
    const { database } = await open();
    database.commit(batch());
    const deletion = batch({
      batchId: "delete",
      sequence: 2,
      expectedRevision: 1,
      operations: [{ type: "setDeleted", deleted: true }]
    });
    expect(database.commit(deletion).generation).toBe(1);
    expect(database.list({ key: deletion.key }).sessions).toHaveLength(0);
    expect(() =>
      database.commit(
        batch({ batchId: "stale", sequence: 3, expectedRevision: 2 })
      )
    ).toThrow("changed");
    expect(() =>
      database.commit(
        batch({
          batchId: "deleted",
          generation: 1,
          sequence: 3,
          expectedRevision: 2
        })
      )
    ).toThrow("Restore");
    expect(
      database.commit(
        batch({
          batchId: "restore",
          generation: 1,
          sequence: 3,
          expectedRevision: 2,
          operations: [{ type: "setDeleted", deleted: false }]
        })
      ).generation
    ).toBe(2);
    expect(database.commit(deletion).generation).toBe(1);
    expect(full(database, "message-1", 3)).toMatchObject({
      content: "虚构测试内容"
    });
  });

  it.each([
    { status: "streaming" },
    { editProposals: [{ status: "pending" }] },
    { editProposals: [{ status: "accepting" }] },
    {
      editProposals: [
        { status: "accepted", discardState: { status: "discarding" } }
      ]
    }
  ])(
    "prevents deletion while a run or review is unresolved: %j",
    async (fields) => {
      const { database } = await open();
      database.commit(
        batch({
          operations: [
            {
              type: "putMessage",
              messageId: "message-1",
              position: 0,
              value: { role: "assistant", content: "测试", ...fields }
            }
          ]
        })
      );
      expect(() =>
        database.commit(
          batch({
            batchId: "delete",
            sequence: 2,
            expectedRevision: 1,
            operations: [{ type: "setDeleted", deleted: true }]
          })
        )
      ).toThrow("pending review");
    }
  );

  it("applies nested append/set/remove without reading historical detail nodes", async () => {
    const { database } = await open();
    const operations: ConversationHistoryBatch["operations"] = Array.from(
      { length: 1000 },
      (_, position) => ({
        type: "putMessage",
        messageId: `message-${position}`,
        position,
        value: {
          role: "assistant",
          content: "历史原文".repeat(2000),
          processingSteps: [
            { type: "response", content: "处理内容".repeat(2000) }
          ],
          editProposals: [
            {
              status: "accepted",
              discardSnapshot: { beforeText: "历史原稿".repeat(2000) }
            }
          ]
        }
      })
    );
    database.commit(batch({ operations }));
    const spy = vi.spyOn(JsonNodes.prototype, "node");
    database.commit(
      batch({
        batchId: "append",
        expectedRevision: 1,
        sequence: 2,
        operations: [
          {
            type: "patchMessage",
            messageId: "message-999",
            changes: [
              { op: "append", path: ["content"], text: "追加😀" },
              {
                op: "append",
                path: ["processingSteps", 0, "content"],
                text: "追加😀"
              },
              { op: "set", path: ["status"], value: "completed" }
            ]
          }
        ]
      })
    );
    expect(spy.mock.calls.length).toBeLessThan(30);
    spy.mockRestore();
    expect(full(database, "message-999", 2)).toMatchObject({
      content: "历史原文".repeat(2000) + "追加😀",
      status: "completed"
    });
    database.commit(
      batch({
        batchId: "remove",
        expectedRevision: 2,
        sequence: 3,
        operations: [
          {
            type: "patchMessage",
            messageId: "message-999",
            changes: [{ op: "remove", path: ["editProposals", 0] }]
          }
        ]
      })
    );
    expect(full(database, "message-999", 3)).toMatchObject({
      editProposals: []
    });
  }, 20_000);
});
