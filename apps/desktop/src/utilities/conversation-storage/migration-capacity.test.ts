import { createHash } from "node:crypto";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ConversationDatabase } from "./database";
import { migrateLegacyFile } from "./legacy-file-migration";

it("migrates an old JSON entry above 64 MiB using bounded parser checkpoints and verifies the complete tool payload", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "deepwrite-large-legacy-migration-")
  );
  const source = join(root, "conversation-persistence.json");
  const path = join(root, "history.sqlite");
  const file = await open(source, "wx");
  const block = "虚构迁移😀".repeat(8192);
  const blocks = 520;
  const expected = createHash("sha256");
  try {
    await file.write(
      '{"version":1,"entries":{"conversation-history:large":{"conversations":[{"messages":[{"id":"message","role":"assistant","content":"完整正文","toolCalls":[{"argumentsText":" { original formatting } ","args":{"content":"'
    );
    for (let index = 0; index < blocks; index++) {
      await file.write(block);
      expected.update(block);
    }
    await file.write(
      '"}}]}],"sessionId":"session","draft":"草稿"}],"activeSessionId":"session","version":1}}}'
    );
  } finally {
    await file.close();
  }
  let database = new ConversationDatabase(path);
  try {
    const size = (await stat(source)).size;
    expect(size).toBeGreaterThan(64 * 1024 * 1024);
    let checkpointMaximum = 0;
    await migrateLegacyFile(database.database, source, () => {
      const row = database.database
        .prepare("SELECT LENGTH(cursor) AS chars FROM migrations")
        .get()!;
      checkpointMaximum = Math.max(checkpointMaximum, Number(row.chars));
    });
    expect(checkpointMaximum).toBeLessThan(512 * 1024);
    expect((await stat(source)).size).toBe(size);
    database.close();
    database = new ConversationDatabase(path);
    const hash = createHash("sha256");
    let offset = 0;
    for (;;) {
      const detail = database.detail({
        key: "conversation-history:large",
        sessionId: "session",
        messageId: "message",
        path: ["toolCalls", 0, "args", "content"],
        expectedRevision: 0,
        offset
      });
      hash.update(detail.chunk);
      if (detail.nextOffset === null) break;
      offset = detail.nextOffset;
    }
    expect(hash.digest("hex")).toBe(expected.digest("hex"));
    expect(
      database.detail({
        key: "conversation-history:large",
        sessionId: "session",
        messageId: "message",
        path: ["toolCalls", 0, "argumentsText"],
        expectedRevision: 0
      }).chunk
    ).toBe(" { original formatting } ");
    expect(
      database.session({
        key: "conversation-history:large",
        sessionId: "session"
      })?.metadata.draft
    ).toBe("草稿");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
