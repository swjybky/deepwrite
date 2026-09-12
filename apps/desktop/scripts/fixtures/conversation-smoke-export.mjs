import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Exercise the packaged Core export handler; Main authorization is covered separately. */
export async function verifyConversationSmokeExport(core, profile) {
  const token = randomUUID();
  const filePath = join(profile, "conversation-export.json");
  await core.command("conversationExport.prepare", { token, filePath });
  const chunks = ['{"draft":"', "未保存正文😀", '","complete":true}'];
  for (const [seq, text] of chunks.entries()) {
    const payload = { token, seq, text };
    const receipt = await core.command("conversationExport.append", payload);
    assert.deepEqual(
      await core.command("conversationExport.append", payload),
      receipt
    );
  }
  const result = await core.command("conversationExport.finish", {
    token,
    seq: chunks.length
  });
  assert.equal(result.bytes, Buffer.byteLength(chunks.join("")));
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
    draft: "未保存正文😀",
    complete: true
  });
}
