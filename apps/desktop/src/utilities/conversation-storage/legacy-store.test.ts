import { afterEach, describe, expect, it } from "vitest";
import { ConversationDatabase } from "./database";
import { LegacyConversationStore } from "./legacy-store";
import { JsonNodes } from "./json-nodes";
import { Statements } from "./schema";

const databases: ConversationDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
const key = "conversation-history:target";
function setup() {
  const database = new ConversationDatabase(":memory:");
  databases.push(database);
  return { database, legacy: new LegacyConversationStore(database.database) };
}
function history(sessionId: string, content = "虚构内容") {
  return {
    version: 1,
    activeSessionId: sessionId,
    future: { retained: true },
    conversations: [
      {
        sessionId,
        messages: [
          {
            id: `message-${sessionId}`,
            role: "user",
            content,
            unknown: [false, { value: "保留" }]
          }
        ],
        draft: "未发草稿"
      }
    ]
  };
}

describe("legacy persistence compatibility", () => {
  it("round trips normalized history and preferences and permits repeated legacy-only saves", () => {
    const { database, legacy } = setup();
    const value = history("session");
    legacy.save(key, value);
    expect(legacy.load(key)).toEqual(value);
    legacy.save(key, history("session", "第二版"));
    legacy.save(key, history("session", "第三版"));
    expect(legacy.load(key)).toEqual(history("session", "第三版"));
    expect(database.session({ key, sessionId: "session" })?.messageCount).toBe(
      1
    );
    legacy.save("conversation-preferences:fixture", {
      modelId: "fixture-model"
    });
    legacy.save("conversation-preferences:fixture", {
      modelId: "next-fixture-model"
    });
    expect(legacy.listHistoryKeys()).toEqual([key]);
    expect(legacy.load("conversation-preferences:fixture")).toEqual({
      modelId: "next-fixture-model"
    });
    expect(
      database.database
        .prepare(
          "SELECT COUNT(*) AS count FROM legacy_backups WHERE key LIKE 'conversation-preferences:%'"
        )
        .get()?.count
    ).toBe(0);
    legacy.remove("conversation-preferences:fixture");
    expect(legacy.load("conversation-preferences:fixture")).toBeUndefined();
  });

  it("rejects unchecked snapshots after incremental writes and permits a matching checked merge", () => {
    const { database, legacy } = setup();
    const original = history("session");
    legacy.save(key, original);
    const state = database.session({ key, sessionId: "session" })!;
    database.commit({
      key,
      sessionId: "session",
      expectedRevision: state.revision,
      generation: state.generation,
      sequence: 1,
      batchId: "incremental",
      operations: [
        {
          type: "patchMessage",
          messageId: "message-session",
          changes: [{ op: "append", path: ["content"], text: "追加" }]
        }
      ]
    });
    expect(() => legacy.save(key, original)).toThrow("incremental history");
    const expected = legacy.load(key)!;
    const sourceKey = "conversation-history:stage";
    const source = history("other");
    legacy.save(sourceKey, source);
    const merged = {
      ...history("session", "虚构内容追加"),
      conversations: [
        ...history("session", "虚构内容追加").conversations,
        ...source.conversations
      ]
    };
    expect(
      legacy.migrateHistory({
        key,
        expected: { found: true, value: original },
        value: merged,
        sources: [{ key: sourceKey, value: source }]
      })
    ).toBe(false);
    expect(
      legacy.migrateHistory({
        key,
        expected: { found: true, value: expected },
        value: merged,
        sources: [{ key: sourceKey, value: source }]
      })
    ).toBe(true);
    expect(legacy.load(key)).toEqual(merged);
    expect(legacy.load(sourceKey)).toBeUndefined();
    expect(
      database.session({ key, sessionId: "session" })!.generation
    ).toBeGreaterThan(state.generation);
    const row = database.database
      .prepare(
        "SELECT value_ref FROM legacy_backups WHERE key = ? ORDER BY id DESC LIMIT 1"
      )
      .get(key)!;
    expect(
      new JsonNodes(new Statements(database.database)).read(
        JSON.parse(String(row.value_ref))
      )
    ).toEqual(expected);
    expect(() =>
      database.commit({
        key: sourceKey,
        sessionId: "new-delayed-session",
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        batchId: "stale",
        operations: [{ type: "setMetadata", value: { draft: "陈旧队列" } }]
      })
    ).toThrow("removed");
  });

  it("rolls back both target and source if importing a checked merge fails", () => {
    const { legacy } = setup();
    const original = history("session");
    const source = history("source");
    const sourceKey = "conversation-history:source";
    legacy.save(key, original);
    legacy.save(sourceKey, source);
    expect(() =>
      legacy.migrateHistory({
        key,
        expected: { found: true, value: original },
        sources: [{ key: sourceKey, value: source }],
        value: {
          version: 1,
          conversations: [
            { sessionId: "broken", messages: [{ content: "missing ID" }] }
          ]
        }
      })
    ).toThrow();
    expect(legacy.load(key)).toEqual(original);
    expect(legacy.load(sourceKey)).toEqual(source);
  });

  it("retains unknown old values and missing active selection without fabricating fields", () => {
    const { legacy } = setup();
    legacy.save(key, { version: 1 });
    expect(legacy.load(key)).toEqual({ version: 1 });
    legacy.save(key, { version: 1, conversations: [] });
    expect(legacy.load(key)).toEqual({ version: 1, conversations: [] });
    legacy.remove(key);
    expect(legacy.load(key)).toBeUndefined();
    expect(legacy.listHistoryKeys()).toEqual([]);
  });
});
