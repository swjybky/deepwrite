import assert from "node:assert/strict";
import { app } from "electron";
import { startConversationSmokeCore } from "./conversation-smoke-core.mjs";

const profile = process.env.DEEPWRITE_CONVERSATION_SMOKE_PROFILE;
const entry = process.env.DEEPWRITE_CONVERSATION_SMOKE_CORE;
assert.ok(profile && entry);
app.setPath("userData", profile);
void app.whenReady().then(async () => {
  let core;
  try {
    core = await startConversationSmokeCore(
      entry,
      profile,
      "shutdown_verification"
    );
    assert.deepEqual(
      await core.command("rendererState.load", {
        key: "conversation-preferences:shutdown-smoke"
      }),
      {
        found: true,
        value: { draft: "pending shutdown draft" }
      }
    );
    await core.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await core?.close().catch(() => undefined);
    app.exit(1);
  }
});
