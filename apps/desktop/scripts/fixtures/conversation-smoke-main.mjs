import assert from "node:assert/strict";
import { app } from "electron";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startConversationSmokeCore } from "./conversation-smoke-core.mjs";
import { verifyConversationSmokeExport } from "./conversation-smoke-export.mjs";

const profile = process.env.DEEPWRITE_CONVERSATION_SMOKE_PROFILE;
const entry = process.env.DEEPWRITE_CONVERSATION_SMOKE_CORE;
assert.ok(profile && entry);
app.setPath("userData", profile);
void app.whenReady().then(async () => {
  const timer = setTimeout(() => app.exit(1), 45_000);
  const key = "conversation-history:storage-smoke";
  const sessionId = "session_smoke";
  const messageId = "message_smoke";
  const legacyPath = join(
    profile,
    "renderer-state/conversation-persistence.json"
  );
  let core;
  try {
    await mkdir(join(profile, "renderer-state"), { recursive: true });
    const legacy = JSON.stringify({
      version: 1,
      entries: {
        "conversation-preferences:storage-smoke": {
          draft: "legacy draft",
          unknown: { keep: true }
        }
      }
    });
    await writeFile(legacyPath, legacy);
    core = await startConversationSmokeCore(entry, profile, "main_smoke_first");
    assert.deepEqual(
      await core.command("rendererState.load", {
        key: "conversation-preferences:storage-smoke"
      }),
      { found: true, value: { draft: "legacy draft", unknown: { keep: true } } }
    );
    const base = { key, sessionId, expectedRevision: 0, generation: 0 };
    const chunk = "正文😀及工具详情\n".repeat(4000);
    const expected = createHash("sha256");
    await core.command("rendererState.history.stage", {
      ...base,
      stageId: "stage_smoke",
      messageId,
      chunkId: "chunk_0",
      sequence: 1,
      value: {
        id: messageId,
        role: "assistant",
        status: "streaming",
        content: "",
        unknown: { keep: true }
      }
    });
    for (let i = 0; i < 24; i += 1) {
      expected.update(chunk);
      await core.command("rendererState.history.stage", {
        ...base,
        stageId: "stage_smoke",
        messageId,
        chunkId: `chunk_${i + 1}`,
        sequence: i + 2,
        changes: [{ op: "append", path: ["content"], text: chunk }]
      });
    }
    const batch = {
      ...base,
      batchId: "batch_smoke",
      sequence: 1,
      operations: [
        {
          type: "putStagedMessage",
          stageId: "stage_smoke",
          messageId,
          position: 0
        },
        {
          type: "setMetadata",
          value: {
            id: sessionId,
            draft: "saved draft",
            updatedAt: "2026-09-11T00:00:00.000Z"
          }
        },
        { type: "setActive", sessionId }
      ]
    };
    const receipt = await core.command("rendererState.history.commit", batch);
    await core.crash();
    core = await startConversationSmokeCore(entry, profile, "main_smoke_first");
    assert.deepEqual(
      await core.command("rendererState.history.commit", batch),
      receipt
    );
    let session = await core.command("rendererState.history.session", {
      key,
      sessionId
    });
    const firstPage = await core.command("rendererState.history.messages", {
      key,
      sessionId,
      maxBytes: 4096
    });
    assert.equal(firstPage.messages[0].value.status, "streaming");
    assert.deepEqual(firstPage.messages[0].value.unknown, { keep: true });
    assert.ok(
      firstPage.messages[0].details.some((ref) => ref.path[0] === "content")
    );
    const actual = createHash("sha256");
    let offset = 0;
    let pages = 0;
    do {
      const part = await core.command("rendererState.history.detail", {
        key,
        sessionId,
        messageId,
        path: ["content"],
        offset,
        expectedRevision: session.revision,
        maxBytes: 64 * 1024
      });
      assert.ok(Buffer.byteLength(part.chunk) <= 64 * 1024);
      actual.update(part.chunk);
      offset = part.nextOffset;
      pages += 1;
    } while (offset !== null);
    assert.ok(pages > 1);
    assert.equal(actual.digest("hex"), expected.digest("hex"));
    await core.close();
    core = await startConversationSmokeCore(
      entry,
      profile,
      "main_smoke_second"
    );
    session = await core.command("rendererState.history.session", {
      key,
      sessionId
    });
    const recovered = await core.command("rendererState.history.messages", {
      key,
      sessionId,
      maxBytes: 4096
    });
    assert.equal(recovered.messages[0].value.status, "stopped");
    assert.equal(session.messageCount, 1);
    await verifyConversationSmokeExport(core, profile);
    await core.close();
    core = undefined;
    assert.equal(await readFile(legacyPath, "utf8"), legacy);
    await access(join(profile, "renderer-state/conversations.sqlite"));
    console.log(
      `DEEPWRITE_CONVERSATION_SMOKE_OK ${JSON.stringify({ electron: process.versions.electron, node: process.versions.node, pages, exported: true })}`
    );
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(error);
    await core?.close().catch(() => undefined);
    clearTimeout(timer);
    app.exit(1);
  }
});
