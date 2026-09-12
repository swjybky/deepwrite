import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ConversationHistoryBatch,
  ConversationHistoryStage
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";

const roots: string[] = [];
const databases: ConversationDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      /* Restart test closes the first instance. */
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function open() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-conversation-staging-"));
  roots.push(root);
  const path = join(root, "history.sqlite");
  const database = new ConversationDatabase(path);
  databases.push(database);
  return { database, path };
}
const identity = {
  key: "conversation-history:fixture",
  sessionId: "session",
  expectedRevision: 0,
  generation: 0
};
function initial(database: ConversationDatabase) {
  database.commit({
    ...identity,
    batchId: "original",
    sequence: 1,
    operations: [
      {
        type: "putMessage",
        messageId: "message",
        position: 0,
        value: {
          content: "已确认旧内容",
          role: "assistant",
          toolCalls: [{ args: "旧参数", argumentsText: " 旧原文 " }]
        }
      }
    ]
  });
}
function prepared(
  overrides: Partial<ConversationHistoryStage> = {}
): ConversationHistoryStage {
  return {
    ...identity,
    expectedRevision: 1,
    stageId: "stage",
    messageId: "message",
    chunkId: "chunk-1",
    sequence: 1,
    value: { content: "替换", role: "assistant" },
    ...overrides
  };
}
function finish(
  overrides: Partial<ConversationHistoryBatch> = {}
): ConversationHistoryBatch {
  return {
    ...identity,
    expectedRevision: 1,
    batchId: "final",
    sequence: 2,
    operations: [
      {
        type: "putStagedMessage",
        stageId: "stage",
        messageId: "message",
        position: 0
      }
    ],
    ...overrides
  };
}
function read(database: ConversationDatabase, revision: number) {
  return JSON.parse(
    database.detail({
      ...identity,
      messageId: "message",
      path: [],
      expectedRevision: revision
    }).chunk
  ) as Record<string, unknown>;
}

describe("atomic conversation message preparation", () => {
  it("keeps the old acknowledged message through interrupted preparation and resumes after restart", async () => {
    const { database, path } = await open();
    initial(database);
    const first = prepared();
    database.stage(first);
    expect(read(database, 1).content).toBe("已确认旧内容");
    database.close();
    const reopened = new ConversationDatabase(path);
    databases.push(reopened);
    expect(reopened.stage(first)).toEqual({
      stageId: "stage",
      chunkId: "chunk-1",
      sequence: 1
    });
    reopened.stage(
      prepared({
        chunkId: "chunk-2",
        sequence: 2,
        value: undefined,
        changes: [{ op: "append", path: ["content"], text: "完成" }]
      })
    );
    expect(read(reopened, 1).content).toBe("已确认旧内容");
    const receipt = reopened.commit(finish());
    expect(read(reopened, 2).content).toBe("替换完成");
    expect(reopened.commit(finish())).toEqual(receipt);
    expect(reopened.stage(first).sequence).toBe(1);
  });

  it("moves a prepared oversized field atomically and retains raw arguments and unrelated message fields", async () => {
    const { database } = await open();
    initial(database);
    database.stage(
      prepared({
        value: {
          value: { text: "虚构字段".repeat(4000), optional: [false, null] }
        }
      })
    );
    const commit = finish({
      operations: [
        {
          type: "setStagedField",
          stageId: "stage",
          messageId: "message",
          path: ["toolCalls", 0, "args"]
        }
      ]
    });
    database.commit(commit);
    expect(read(database, 2)).toEqual({
      content: "已确认旧内容",
      role: "assistant",
      toolCalls: [
        {
          args: { text: "虚构字段".repeat(4000), optional: [false, null] },
          argumentsText: " 旧原文 "
        }
      ]
    });
    expect(
      database.database
        .prepare(
          "SELECT COUNT(*) AS count FROM stages WHERE value_ref IS NOT NULL"
        )
        .get()?.count
    ).toBe(0);
  });

  it("rolls back ownership transfer if a later operation fails and permits a retry", async () => {
    const { database } = await open();
    initial(database);
    database.stage(prepared());
    expect(() =>
      database.commit(
        finish({
          operations: [
            finish().operations[0]!,
            {
              type: "patchMessage",
              messageId: "missing",
              changes: [{ op: "append", path: ["content"], text: "失败" }]
            }
          ]
        })
      )
    ).toThrow();
    expect(read(database, 1).content).toBe("已确认旧内容");
    database.commit(finish());
    expect(read(database, 2).content).toBe("替换");
  });

  it("rejects reused IDs with different content, out-of-order chunks and stale prepared content", async () => {
    const { database } = await open();
    initial(database);
    database.stage(prepared());
    expect(() =>
      database.stage(prepared({ value: { content: "不一样" } }))
    ).toThrow("reused");
    expect(() =>
      database.stage(
        prepared({
          sequence: 3,
          chunkId: "third",
          value: undefined,
          changes: [{ op: "append", path: ["content"], text: "缺块" }]
        })
      )
    ).toThrow("order");
    const other = finish({
      batchId: "other",
      operations: [
        {
          type: "patchMessage",
          messageId: "message",
          changes: [{ op: "append", path: ["content"], text: "新修改" }]
        }
      ]
    });
    database.commit(other);
    expect(() =>
      database.commit({
        ...other,
        operations: [{ type: "setDeleted", deleted: true }]
      })
    ).toThrow("reused");
    expect(() =>
      database.commit(finish({ expectedRevision: 2, sequence: 3 }))
    ).toThrow("prepared message");
    expect(read(database, 2).content).toBe("已确认旧内容新修改");
  });
});
