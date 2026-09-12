import { afterEach, describe, expect, it } from "vitest";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryStageSchema
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";

const databases: ConversationDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
function open() {
  const database = new ConversationDatabase(":memory:");
  databases.push(database);
  return database;
}
const identity = {
  key: "conversation-history:fixture",
  sessionId: "session",
  generation: 0
};

describe("bounded metadata persistence and queries", () => {
  it("prepares a large draft atomically, preserves unknown metadata and reads it through bounded references", () => {
    const database = open();
    database.commit({
      ...identity,
      expectedRevision: 0,
      sequence: 1,
      batchId: "initial",
      operations: [
        {
          type: "setMetadata",
          value: {
            sessionId: "session",
            draft: "已确认草稿",
            unknown: { retained: true },
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        }
      ]
    });
    const block = '虚构草稿😀\n"'.repeat(6000);
    const stage = {
      ...identity,
      expectedRevision: 1,
      stageId: "draft",
      target: "metadata" as const
    };
    database.stage(
      ConversationHistoryStageSchema.parse({
        ...stage,
        sequence: 1,
        chunkId: "first",
        value: { value: "" }
      })
    );
    for (let index = 0; index < 100; index++)
      database.stage(
        ConversationHistoryStageSchema.parse({
          ...stage,
          sequence: index + 2,
          chunkId: `chunk-${index}`,
          changes: [{ op: "append", path: ["value"], text: block }]
        })
      );
    expect(database.session(identity)?.metadata.draft).toBe("已确认草稿");
    const commit = ConversationHistoryBatchSchema.parse({
      ...identity,
      expectedRevision: 1,
      sequence: 2,
      batchId: "final",
      operations: [
        { type: "setStagedMetadata", stageId: "draft", path: ["draft"] }
      ]
    });
    database.commit(commit);
    const session = database.session({ ...identity, maxBytes: 1024 })!;
    expect(Buffer.byteLength(JSON.stringify(session))).toBeLessThanOrEqual(
      1024
    );
    expect(session.metadata.draft).toBeUndefined();
    expect(session.metadata.unknown).toEqual({ retained: true });
    expect(
      session.metadataDetails?.find((ref) => ref.path[0] === "draft")
        ?.byteLength
    ).toBe(Buffer.byteLength(block) * 100);
    expect(session.metadataByteLength).toBeGreaterThan(4 * 1024 * 1024);
    let offset = 0;
    let draft = "";
    for (;;) {
      const part = database.metadataDetail({
        ...identity,
        path: ["draft"],
        offset,
        maxBytes: 65536,
        expectedRevision: 2
      });
      expect(Buffer.byteLength(part.chunk)).toBeLessThanOrEqual(65536);
      draft += part.chunk;
      if (part.nextOffset === null) break;
      offset = part.nextOffset;
    }
    expect(draft).toBe(block.repeat(100));
    expect(database.commit(commit).revision).toBe(2);
    expect(() =>
      database.metadataDetail({ ...identity, path: [], expectedRevision: 1 })
    ).toThrow("changed");
  });

  it("uses summaries and a byte budget when listing many sessions with heavy metadata", () => {
    const database = open();
    for (let index = 0; index < 20; index++)
      database.commit({
        ...identity,
        sessionId: `session-${index}`,
        expectedRevision: 0,
        sequence: 1,
        batchId: "initial",
        operations: [
          {
            type: "setMetadata",
            value: {
              sessionId: `session-${index}`,
              draft: "巨大草稿".repeat(2000),
              future: { big: "未来字段".repeat(2000) },
              createdAt: "2026-01-01T00:00:00.000Z"
            }
          }
        ]
      });
    let afterSessionId: string | undefined;
    const seen: string[] = [];
    for (;;) {
      const page = database.list({
        key: identity.key,
        afterSessionId,
        limit: 200,
        maxBytes: 2048
      });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2048);
      expect(
        page.sessions.every(
          (session) =>
            session.metadata.draft === undefined &&
            session.metadata.future === undefined
        )
      ).toBe(true);
      seen.push(...page.sessions.map((session) => session.sessionId));
      if (!page.nextSessionId) break;
      expect(page.nextSessionId).not.toBe(afterSessionId);
      afterSessionId = page.nextSessionId;
    }
    expect(new Set(seen).size).toBe(20);
  });

  it("separates message and metadata preparation and rolls back a failed metadata swap", () => {
    const database = open();
    database.commit({
      ...identity,
      expectedRevision: 0,
      sequence: 1,
      batchId: "initial",
      operations: [{ type: "setMetadata", value: { draft: "旧草稿" } }]
    });
    database.stage({
      ...identity,
      expectedRevision: 1,
      target: "metadata",
      stageId: "metadata",
      chunkId: "first",
      sequence: 1,
      value: { value: "新草稿" }
    });
    const base = {
      ...identity,
      expectedRevision: 1,
      sequence: 2,
      batchId: "final"
    };
    expect(() =>
      database.commit({
        ...base,
        operations: [
          {
            type: "putStagedMessage",
            stageId: "metadata",
            messageId: "message",
            position: 0
          }
        ]
      })
    ).toThrow("prepared message");
    expect(() =>
      database.commit({
        ...base,
        operations: [
          { type: "setStagedMetadata", stageId: "metadata", path: ["draft"] },
          {
            type: "patchMessage",
            messageId: "missing",
            changes: [{ op: "append", path: ["content"], text: "失败" }]
          }
        ]
      })
    ).toThrow();
    expect(database.session(identity)?.metadata.draft).toBe("旧草稿");
    database.commit({
      ...base,
      operations: [
        { type: "setStagedMetadata", stageId: "metadata", path: ["draft"] }
      ]
    });
    expect(database.session(identity)?.metadata.draft).toBe("新草稿");
    expect(
      ConversationHistoryStageSchema.safeParse({
        ...identity,
        expectedRevision: 2,
        target: "metadata",
        messageId: "message",
        stageId: "wrong",
        chunkId: "first",
        sequence: 1,
        value: {}
      }).success
    ).toBe(false);
  });
});
