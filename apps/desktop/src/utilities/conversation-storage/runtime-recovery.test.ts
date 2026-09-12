import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ConversationDatabase } from "./database";

it("recovers only on a new Main instance and fences both writes and restarting retired workers", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-main-recovery-"));
  const path = join(root, "history.sqlite");
  const original = new ConversationDatabase(path);
  const sameMain = new ConversationDatabase(path);
  const newMain = new ConversationDatabase(path);
  const key = "conversation-history:fixture";
  const identity = { key, sessionId: "session", generation: 0 };
  try {
    original.claimMainInstance("fixture-main-one");
    original.commit({
      ...identity,
      expectedRevision: 0,
      sequence: 1,
      batchId: "initial",
      operations: [
        {
          type: "putMessage",
          messageId: "message",
          position: 0,
          value: {
            role: "assistant",
            content: "已落盘的流式正文",
            status: "streaming",
            future: { retained: true },
            editProposals: [
              {
                id: "proposal",
                status: "pending",
                discardSnapshot: { beforeText: "原稿" }
              }
            ]
          }
        }
      ]
    });
    sameMain.claimMainInstance("fixture-main-one");
    expect(
      sameMain.detail({
        key,
        sessionId: "session",
        messageId: "message",
        path: ["status"],
        expectedRevision: 1
      }).chunk
    ).toBe("streaming");
    newMain.claimMainInstance("fixture-main-two");
    const result = JSON.parse(
      newMain.detail({
        key,
        sessionId: "session",
        messageId: "message",
        path: [],
        expectedRevision: 2
      }).chunk
    );
    expect(result).toEqual({
      role: "assistant",
      content: "已落盘的流式正文",
      status: "stopped",
      future: { retained: true },
      editProposals: [
        {
          id: "proposal",
          status: "pending",
          discardSnapshot: { beforeText: "原稿" }
        }
      ]
    });
    expect(() =>
      original.commit({
        ...identity,
        expectedRevision: 2,
        sequence: 2,
        batchId: "old-write",
        operations: [
          {
            type: "patchMessage",
            messageId: "message",
            changes: [{ op: "append", path: ["content"], text: "旧运行尾部" }]
          }
        ]
      })
    ).toThrow("newer application");
    expect(() =>
      original.stage({
        ...identity,
        expectedRevision: 2,
        messageId: "message",
        stageId: "old-stage",
        sequence: 1,
        chunkId: "chunk",
        value: { content: "旧运行" }
      })
    ).toThrow("newer application");
    expect(() => sameMain.claimMainInstance("fixture-main-one")).toThrow(
      "retired"
    );
    expect(() =>
      newMain.commit({
        ...identity,
        expectedRevision: 2,
        sequence: 2,
        batchId: "delete",
        operations: [{ type: "setDeleted", deleted: true }]
      })
    ).toThrow("pending review");
    newMain.claimMainInstance("fixture-main-two");
    expect(newMain.session({ key, sessionId: "session" })?.revision).toBe(2);
  } finally {
    original.close();
    sameMain.close();
    newMain.close();
    await rm(root, { recursive: true, force: true });
  }
});
