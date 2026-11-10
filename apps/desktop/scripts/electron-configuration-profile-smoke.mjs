import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();
const scripts = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scripts, "../../..");
const entry = join(repository, "apps/desktop/out/main/index.js");
const dist = join(repository, "node_modules/electron/dist");
const electron =
  process.platform === "darwin"
    ? join(dist, "Electron.app/Contents/MacOS/Electron")
    : join(dist, process.platform === "win32" ? "electron.exe" : "electron");
await Promise.all([access(entry), access(electron)]);
const root = await realpath(
  await mkdtemp(join(tmpdir(), "deepwrite-configuration-smoke-"))
);
await Promise.all(
  ["app-data", "home", "documents", "legacy"].map((path) =>
    mkdir(join(root, path))
  )
);
const formalConfig = join(
  root,
  "app-data",
  "DeepWriteConfigurationSmoke",
  "config"
);
await mkdir(formalConfig, { recursive: true });
await writeFile(
  join(formalConfig, "general-settings.json"),
  JSON.stringify({
    version: 2,
    permissionMode: "auto-approve",
    autoSave: true,
    language: "auto",
    showInMenuBar: false,
    showContextUsage: false
  })
);
const children = [];

function launch(phase) {
  const child = spawn(
    electron,
    [
      join(scripts, "fixtures/configuration-profile-smoke-main.mjs"),
      ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        ELECTRON_RENDERER_URL: "",
        DEEPWRITE_SMOKE: "0",
        DEEPWRITE_STORAGE_SMOKE: "",
        DEEPWRITE_CONFIGURATION_SMOKE_ROOT: root,
        DEEPWRITE_CONFIGURATION_SMOKE_PHASE: phase,
        DEEPWRITE_CONFIGURATION_SMOKE_ENTRY: entry,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const messages = new Set();
  let pending = "";
  let settled = false;
  let exitCode;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const prefix = `DEEPWRITE_CONFIGURATION_SMOKE ${phase}:`;
      if (line.startsWith(prefix)) messages.add(line.slice(prefix.length));
    }
  });
  child.stderr.resume();
  const completion = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      settled = true;
      exitCode = code;
      resolveExit(code);
    });
  });
  const wait = async (status) => {
    const deadline = Date.now() + 45_000;
    while (!messages.has(status)) {
      if (settled || messages.has("failed") || Date.now() >= deadline)
        throw new Error(
          `Configuration smoke ${phase} did not reach ${status} (exit ${String(exitCode)}, stages ${[...messages].join(",")}).`
        );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  };
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  void completion.finally(() => clearTimeout(timeout));
  const run = { child, completion, wait };
  children.push(run);
  return run;
}

try {
  const formal = launch("formal");
  await formal.wait("ready");
  if (process.platform === "win32") {
    const state = join(formalConfig, "..", "Local State");
    const deadline = Date.now() + 30_000;
    for (;;) {
      const contents = await readFile(state, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      });
      if (JSON.parse(contents).os_crypt?.encrypted_key) break;
      if (Date.now() >= deadline)
        throw new Error("Windows encryption state was not persisted.");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  const development = launch("development");
  await development.wait("ready");
  assert.equal(await development.completion, 0);
  await writeFile(join(root, "finish"), "finish");
  await formal.wait("verified");
  assert.equal(await formal.completion, 0);
  console.log(
    "DEEPWRITE_CONFIGURATION_SMOKE_OK sharedSettings=true encryptedKey=true parallelInstances=true privateSessions=true privateBrowserStorage=true"
  );
} finally {
  for (const run of children) {
    if (run.child.exitCode === null && run.child.signalCode === null)
      run.child.kill("SIGKILL");
  }
  await Promise.allSettled(children.map((run) => run.completion));
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
