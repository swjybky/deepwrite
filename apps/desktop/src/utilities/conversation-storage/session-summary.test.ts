import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./database";
import { JsonNodes } from "./json-nodes";
import { TextChunks } from "./text-chunks";
import { appendCompactPrefix } from "./text-preview";

const databases: ConversationDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => database.close());
});
const identity = { key: "conversation-history:fixture", sessionId: "session" };
function open() {
  const database = new ConversationDatabase(":memory:");
  databases.push(database);
  return database;
}

describe("indexed conversation summaries", () => {
  it("matches history title, last visible content and turn counts without reading stored bodies", () => {
    const database = open();
    database.commit({
      ...identity,
      batchId: "initial",
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      operations: [
        { type: "setMetadata", value: { draft: "  备用  草稿  " } },
        {
          type: "putMessage",
          messageId: "first",
          position: 0,
          value: {
            role: "user",
            content: " \n".repeat(5000) + "第一  个问题 " + "甲".repeat(100)
          }
        },
        {
          type: "putMessage",
          messageId: "last",
          position: 1,
          value: {
            role: "assistant",
            content:
              "\t".repeat(150000) + "末尾\n 可见\t正文 " + "乙".repeat(100)
          }
        },
        {
          type: "putMessage",
          messageId: "empty",
          position: 2,
          value: { role: "user", content: " \n\t".repeat(5000) }
        }
      ]
    });
    const read = vi.spyOn(TextChunks.prototype, "read");
    const range = vi.spyOn(TextChunks.prototype, "readRange");
    const jsonParts = vi.spyOn(JsonNodes.prototype, "jsonParts");
    const summary = database.list({ key: identity.key }).sessions[0]!.summary!;
    expect(summary).toEqual({
      title: ("第一 个问题 " + "甲".repeat(100)).slice(0, 41) + "…",
      preview: ("末尾 可见 正文 " + "乙".repeat(100)).slice(0, 75) + "…",
      turnCount: 2
    });
    expect(read).not.toHaveBeenCalled();
    expect(range).not.toHaveBeenCalled();
    expect(jsonParts).not.toHaveBeenCalled();
    database.commit({
      ...identity,
      batchId: "reorder",
      expectedRevision: 1,
      generation: 0,
      sequence: 2,
      operations: [{ type: "moveMessage", messageId: "first", position: 3 }]
    });
    expect(database.session(identity)?.summary?.title).toBe("");
    expect(database.session(identity)?.summary?.preview).toBe(
      ("第一 个问题 " + "甲".repeat(100)).slice(0, 75) + "…"
    );
    database.commit({
      ...identity,
      batchId: "remove",
      expectedRevision: 2,
      generation: 0,
      sequence: 3,
      operations: [
        { type: "removeMessages", messageIds: ["first", "last", "empty"] }
      ]
    });
    expect(database.session(identity)?.summary).toEqual({
      title: "未命名对话",
      preview: "备用 草稿",
      turnCount: 0
    });
  });

  it("normalizes whitespace across appended chunks and includes newly visible text after a large blank draft", () => {
    const database = open();
    database.commit({
      ...identity,
      batchId: "initial",
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      operations: [
        {
          type: "putMessage",
          messageId: "message",
          position: 0,
          value: { role: "assistant", content: " ".repeat(200000) }
        }
      ]
    });
    for (const [index, text] of ["  新", " \n", "正文   "].entries())
      database.commit({
        ...identity,
        batchId: `append-${index}`,
        expectedRevision: index + 1,
        generation: 0,
        sequence: index + 2,
        operations: [
          {
            type: "patchMessage",
            messageId: "message",
            changes: [{ op: "append", path: ["content"], text }]
          }
        ]
      });
    expect(database.session(identity)?.summary?.preview).toBe("新 正文");
    const parts = [" 甲 ", "\n", " 乙", " 丙  "];
    const compact = parts.reduce(appendCompactPrefix, {
      prefix: "",
      pendingSpace: false
    });
    expect(compact.prefix).toBe(parts.join("").replace(/\s+/g, " ").trim());
  });
});
