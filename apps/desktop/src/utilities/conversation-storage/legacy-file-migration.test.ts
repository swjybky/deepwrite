import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationDatabase } from "./database";
import { migrateLegacyFile } from "./legacy-file-migration";
import { JsonNodes } from "./json-nodes";
import { Statements } from "./schema";

const roots: string[] = [];
const databases: ConversationDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      /* Closed by restart test. */
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
const key = "conversation-history:fixture";
async function fixture(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-legacy-migration-"));
  roots.push(root);
  const path = join(root, "history.sqlite");
  const source = join(root, "conversation-persistence.json");
  const original = JSON.stringify({
    version: 1,
    entries: {
      [key]: value,
      "conversation-preferences:fixture": {
        selectedModelId: "fixture-model",
        future: [1, false]
      }
    },
    futureDiskField: "preserved"
  });
  await writeFile(source, original);
  const database = new ConversationDatabase(path);
  databases.push(database);
  return { database, path, source, original };
}
function read(database: ConversationDatabase, messageId: string): unknown {
  let offset = 0;
  let text = "";
  for (;;) {
    const detail = database.detail({
      key,
      sessionId: "session",
      messageId,
      path: [],
      expectedRevision: 0,
      maxBytes: 65536,
      offset
    });
    text += detail.chunk;
    if (detail.nextOffset === null) return JSON.parse(text);
    offset = detail.nextOffset;
  }
}

describe("legacy file migration", () => {
  it("resumes inside a large escaped UTF-8 string and preserves source bytes, unknown metadata and trailing session identifiers", async () => {
    const message = {
      role: "assistant",
      content: '正文😀\n\\"'.repeat(50_000),
      toolCalls: [
        { args: { value: "参数" }, argumentsText: '{ "value" : "参数" }' }
      ],
      editProposals: [
        { status: "accepted", discardSnapshot: { beforeText: "完整撤销原稿" } }
      ],
      id: "message"
    };
    const value = {
      conversations: [
        {
          messages: [message],
          draft: "未发草稿",
          future: { retained: true },
          sessionId: "session"
        }
      ],
      activeSessionId: "session",
      version: 1,
      futureEnvelope: ["preserved"]
    };
    const { database, path, source, original } = await fixture(value);
    await expect(
      migrateLegacyFile(database.database, source, (offset) => {
        if (offset > 65536) throw new Error("simulated interruption");
      })
    ).rejects.toThrow("interruption");
    expect(
      database.database.prepare("SELECT state FROM migrations").get()?.state
    ).toBe("parsing");
    database.close();
    const reopened = new ConversationDatabase(path);
    databases.push(reopened);
    await migrateLegacyFile(reopened.database, source);
    expect(read(reopened, "message")).toEqual(message);
    expect(
      reopened.session({ key, sessionId: "session" })?.metadata
    ).toMatchObject({
      future: { retained: true },
      draft: "未发草稿",
      sessionId: "session"
    });
    expect(await readFile(source, "utf8")).toBe(original);
    const row = reopened.database
      .prepare("SELECT fingerprint, state, checked_records FROM migrations")
      .get()!;
    expect(row.fingerprint).toBe(
      createHash("sha256").update(original).digest("hex")
    );
    expect(row.state).toBe("complete");
    expect(row.checked_records).toBe(1);
    const preference = reopened.database
      .prepare("SELECT value_ref FROM legacy_values WHERE key = ?")
      .get("conversation-preferences:fixture")!;
    expect(
      new JsonNodes(new Statements(reopened.database)).read(
        JSON.parse(String(preference.value_ref))
      )
    ).toEqual({ selectedModelId: "fixture-model", future: [1, false] });
    await migrateLegacyFile(reopened.database, source);
    expect(reopened.session({ key, sessionId: "session" })?.messageCount).toBe(
      1
    );
  });

  it("resumes at the next message after a transaction fails during normalization", async () => {
    const messages = [
      { id: "first", role: "user", content: "第一条" },
      { id: "second", role: "assistant", content: "第二条" }
    ];
    const { database, path, source } = await fixture({
      version: 1,
      activeSessionId: "session",
      conversations: [{ sessionId: "session", messages }]
    });
    database.database.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON messages WHEN NEW.message_id = 'second' BEGIN SELECT RAISE(ABORT, 'simulated transaction failure'); END;"
    );
    await expect(migrateLegacyFile(database.database, source)).rejects.toThrow(
      "simulated"
    );
    expect(
      database.database.prepare("SELECT checked_records FROM migrations").get()
        ?.checked_records
    ).toBe(1);
    database.close();
    const reopened = new ConversationDatabase(path);
    databases.push(reopened);
    reopened.database.exec("DROP TRIGGER fail_second");
    await migrateLegacyFile(reopened.database, source);
    expect(read(reopened, "first")).toEqual(messages[0]);
    expect(read(reopened, "second")).toEqual(messages[1]);
    expect(reopened.session({ key, sessionId: "session" })?.messageCount).toBe(
      2
    );
  });

  it("does not activate corrupt, changed, or truncated sources and never rewrites them", async () => {
    const { database, source } = await fixture({
      version: 1,
      conversations: []
    });
    await writeFile(
      source,
      '{"version":1,"entries":{"conversation-history:fixture":{"unfinished":"'
    );
    await expect(migrateLegacyFile(database.database, source)).rejects.toThrow(
      "incomplete"
    );
    expect(
      database.database.prepare("SELECT state FROM migrations").get()?.state
    ).toBe("parsing");
    await writeFile(source, '{"version":1,"entries":{}}');
    await expect(migrateLegacyFile(database.database, source)).rejects.toThrow(
      "changed"
    );
    expect(await readFile(source, "utf8")).toBe('{"version":1,"entries":{}}');
  });

  it("ignores later changes to the old JSON after migration is activated", async () => {
    const { database, source } = await fixture({
      version: 1,
      conversations: []
    });
    await migrateLegacyFile(database.database, source);
    await writeFile(source, "old application changed this file");
    await migrateLegacyFile(database.database, source);
    expect(
      database.database.prepare("SELECT state FROM migrations").get()?.state
    ).toBe("complete");
  });
});
