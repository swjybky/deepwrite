import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ConversationHistoryStageSchema } from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";

it("commits and restores more than 64 MiB per session and 256 MiB total through bounded chunks", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "deepwrite-conversation-capacity-")
  );
  const path = join(root, "history.sqlite");
  let database = new ConversationDatabase(path);
  const block = "虚构容量验证😀".repeat(8192);
  const blocks = 384;
  const key = "conversation-history:capacity";
  const expectedBytes = Buffer.byteLength(block) * blocks;
  expect(expectedBytes).toBeGreaterThan(64 * 1024 * 1024);
  const expectedHash = createHash("sha256");
  for (let i = 0; i < blocks; i++) expectedHash.update(block);
  const digest = expectedHash.digest("hex");
  try {
    for (let session = 0; session < 4; session++) {
      const identity = {
        key,
        sessionId: `session-${session}`,
        expectedRevision: 0,
        generation: 0
      };
      const prepared = {
        ...identity,
        stageId: "large-message",
        messageId: "message"
      };
      database.stage(
        ConversationHistoryStageSchema.parse({
          ...prepared,
          chunkId: "initial",
          sequence: 1,
          value: {
            role: "assistant",
            content: "",
            toolCalls: [{ argumentsText: "保留原始参数", args: { value: 1 } }]
          }
        })
      );
      for (let index = 0; index < blocks; index++) {
        database.stage(
          ConversationHistoryStageSchema.parse({
            ...prepared,
            chunkId: `chunk-${index}`,
            sequence: index + 2,
            changes: [{ op: "append", path: ["content"], text: block }]
          })
        );
      }
      database.commit({
        ...identity,
        batchId: "finish",
        sequence: 1,
        operations: [
          {
            type: "putStagedMessage",
            stageId: "large-message",
            messageId: "message",
            position: 0
          }
        ]
      });
      expect(database.session(identity)?.byteLength).toBeGreaterThan(
        64 * 1024 * 1024
      );
    }
    expect(
      database
        .list({ key })
        .sessions.reduce((bytes, session) => bytes + session.byteLength, 0)
    ).toBeGreaterThan(256 * 1024 * 1024);
    database.commit({
      key,
      sessionId: "independent",
      expectedRevision: 0,
      generation: 0,
      batchId: "small",
      sequence: 1,
      operations: [
        {
          type: "putMessage",
          messageId: "small",
          position: 0,
          value: { role: "user", content: "大历史之后的新会话" }
        }
      ]
    });
    database.close();
    database = new ConversationDatabase(path);
    for (let session = 0; session < 4; session++) {
      const hash = createHash("sha256");
      let offset = 0;
      let bytes = 0;
      for (;;) {
        const detail = database.detail({
          key,
          sessionId: `session-${session}`,
          messageId: "message",
          path: ["content"],
          expectedRevision: 1,
          maxBytes: 1024 * 1024,
          offset
        });
        expect(Buffer.byteLength(detail.chunk)).toBeLessThanOrEqual(
          1024 * 1024
        );
        hash.update(detail.chunk);
        bytes += Buffer.byteLength(detail.chunk);
        if (detail.nextOffset === null) break;
        expect(detail.nextOffset).toBeGreaterThan(offset);
        offset = detail.nextOffset;
      }
      expect(bytes).toBe(expectedBytes);
      expect(hash.digest("hex")).toBe(digest);
    }
    expect(
      database.messages({ key, sessionId: "independent" }).messages[0]?.value
        .content
    ).toBe("大历史之后的新会话");
    database.commit({
      key,
      sessionId: "session-0",
      expectedRevision: 1,
      generation: 0,
      batchId: "continue",
      sequence: 2,
      operations: [
        {
          type: "patchMessage",
          messageId: "message",
          changes: [{ op: "append", path: ["content"], text: "重启后继续" }]
        }
      ]
    });
    database.close();
    database = new ConversationDatabase(path);
    expect(
      database.detail({
        key,
        sessionId: "session-0",
        messageId: "message",
        path: ["content"],
        expectedRevision: 2,
        offset: block.length * blocks
      }).chunk
    ).toBe("重启后继续");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
