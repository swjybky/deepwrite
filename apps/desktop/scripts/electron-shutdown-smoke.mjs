import assert from "node:assert/strict";
import { spawn, execFile, execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../../..");
const prefix = "DEEPWRITE_SHUTDOWN_SMOKE ";
const scenario = process.argv[2];

if (!scenario) {
  for (const current of ["ready", "startup"]) {
    await new Promise((resolve, reject) => {
      const run = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), current],
        {
          stdio: "inherit"
        }
      );
      run.once("error", reject);
      run.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Shutdown smoke failed: ${current}`))
      );
    });
  }
  process.exit(0);
}
if (scenario !== "ready" && scenario !== "startup")
  throw new Error("Unknown shutdown smoke scenario.");

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

if (process.platform === "win32") {
  throw new Error("The process-group SIGINT smoke requires macOS or Linux.");
}
await access(join(root, "apps/desktop/out/main/index.js"));
const pnpm = process.env.npm_execpath;
if (!pnpm)
  throw new Error("Run this check with pnpm smoke:shutdown after pnpm build.");
const port = await unusedPort();

const profile = await mkdtemp(join(tmpdir(), "deepwrite-shutdown-smoke-"));
await mkdir(join(profile, "config"));
await mkdir(join(profile, "documents"));
await writeFile(
  join(profile, "config/workspace-directory.json"),
  JSON.stringify({ version: 1, path: join(profile, "documents") })
);

const events = [];
let stdout = "";
let spawnError;
const child = spawn(
  process.execPath,
  [
    pnpm,
    "run",
    "dev",
    "--rendererOnly",
    "--config",
    join(scriptDir, "fixtures/shutdown-smoke.config.mjs")
  ],
  {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      DEEPWRITE_SHUTDOWN_SMOKE_ROOT: root,
      DEEPWRITE_SHUTDOWN_SMOKE_PROFILE: profile,
      DEEPWRITE_SHUTDOWN_SMOKE_PORT: String(port),
      DEEPWRITE_SHUTDOWN_SMOKE_SCENARIO: scenario,
      ELECTRON_ENTRY: join(scriptDir, "fixtures/shutdown-smoke-main.mjs"),
      ELECTRON_CLI_ARGS: JSON.stringify([`--user-data-dir=${profile}`])
    },
    stdio: ["ignore", "pipe", "ignore"]
  }
);
child.on("error", (error) => {
  spawnError = error.code ?? "spawn_failed";
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  const lines = stdout.split(/\r?\n/);
  stdout = lines.pop() ?? "";
  for (const line of lines) {
    // Print only our status markers, never app logs or local configuration.
    if (line.startsWith(prefix))
      events.push(JSON.parse(line.slice(prefix.length)));
  }
});

function groupMembers() {
  if (!child.pid) return [];
  const groups = ownedGroups();
  return execFileSync("ps", ["-axo", "pid=,pgid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, group]) => groups.includes(group))
    .map(([pid]) => pid);
}

function ownedGroups() {
  return [
    child.pid,
    ...events
      .filter((event) => event.type === "dev-group")
      .map((event) => event.pid)
  ];
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (spawnError) throw new Error(`Development runner failed: ${spawnError}`);
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function cleanup() {
  if (groupMembers().length) {
    // Only the isolated test process group belongs to this check.
    for (const group of ownedGroups()) {
      try {
        process.kill(-group, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await waitFor(
      () => groupMembers().length === 0,
      5_000,
      "test process cleanup"
    );
  }
  child.stdout.destroy();
  await rm(profile, { recursive: true, force: true });
}

try {
  await waitFor(
    () =>
      events.some(
        (event) =>
          event.type === (scenario === "startup" ? "module-pending" : "ready")
      ),
    30_000,
    "renderer and three utilities ready"
  );
  const started = Date.now();
  if (scenario === "startup")
    assert.ok(!events.some((event) => event.type === "ready"));
  process.kill(-child.pid, "SIGINT");
  if (scenario === "startup") {
    // A second interrupt must not kill Vite while the workspace is loading.
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.kill(-child.pid, "SIGINT");
  }
  await waitFor(
    () => events.some((event) => event.type === "quit"),
    30_000,
    "graceful exit after process-group SIGINT"
  );
  await waitFor(
    () => groupMembers().length === 0,
    5_000,
    "all development processes exited"
  );
  assert.ok(
    events.some((event) => event.type === "save" && event.status === "accepted")
  );
  assert.ok(
    events.some((event) => event.type === "flush" && event.ok === true)
  );
  assert.ok(!events.some((event) => event.type === "flush" && !event.ok));
  assert.ok(
    !events.some(
      (event) =>
        event.type === "module-failed" || event.type === "compiler-stopped"
    )
  );
  if (scenario === "startup") {
    const quitting = events.findIndex((event) => event.type === "before-quit");
    const ready = events.findIndex((event) => event.type === "ready");
    assert.ok(quitting >= 0 && ready > quitting);
  }
  assert.deepEqual(
    events.find((event) => event.type === "quit"),
    { type: "quit", code: 0, forks: 3 }
  );
  // Reopen through a new Electron Core/worker after every development process
  // has exited; a successful in-memory read cannot satisfy this assertion.
  const electronDist = join(root, "node_modules/electron/dist");
  const electron =
    process.platform === "darwin"
      ? join(electronDist, "Electron.app/Contents/MacOS/Electron")
      : join(electronDist, "electron");
  await promisify(execFile)(
    electron,
    [join(scriptDir, "fixtures/conversation-smoke-reopen.mjs"), "--no-sandbox"],
    {
      env: {
        ...process.env,
        DEEPWRITE_CONVERSATION_SMOKE_PROFILE: profile,
        DEEPWRITE_CONVERSATION_SMOKE_CORE: join(
          root,
          "apps/desktop/out/main/utilities/core-entry.js"
        )
      },
      timeout: 15_000
    }
  );
  console.log(
    `Shutdown smoke passed (${scenario}): final write persisted, no worker restarts or orphan processes (${Date.now() - started} ms).`
  );
} catch (error) {
  console.error(`Shutdown status markers: ${JSON.stringify(events)}`);
  throw error;
} finally {
  await cleanup();
}
