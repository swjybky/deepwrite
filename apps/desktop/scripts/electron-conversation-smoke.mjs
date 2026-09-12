import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../../..");
const dist = join(root, "node_modules/electron/dist");
const binary =
  process.platform === "darwin"
    ? join(dist, "Electron.app/Contents/MacOS/Electron")
    : join(dist, process.platform === "win32" ? "electron.exe" : "electron");
const core = join(root, "apps/desktop/out/main/utilities/core-entry.js");
await access(core);
await access(join(dirname(core), "conversation-storage/worker-entry.js"));
const profile = await mkdtemp(join(tmpdir(), "deepwrite-conversation-smoke-"));
try {
  const child = spawn(
    binary,
    [join(scriptDir, "fixtures/conversation-smoke-main.mjs"), "--no-sandbox"],
    {
      env: {
        ...process.env,
        DEEPWRITE_CONVERSATION_SMOKE_PROFILE: profile,
        DEEPWRITE_CONVERSATION_SMOKE_CORE: core
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timeout));
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_CONVERSATION_SMOKE_OK "));
  assert.equal(exit, 0, output);
  assert.ok(marker, output);
  console.log(marker);
  console.log(
    "Conversation smoke passed: actual Core and storage worker migration, chunked write/read, crash recovery, idempotent retry and clean shutdown."
  );
} finally {
  await rm(profile, { recursive: true, force: true });
}
