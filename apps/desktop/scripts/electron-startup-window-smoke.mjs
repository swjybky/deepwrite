import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();
const scripts = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scripts, "../../..");
const root = await mkdtemp(join(tmpdir(), "deepwrite-startup-window-"));
const electron = join(
  repository,
  "node_modules/electron/dist",
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron"
);
try {
  await Promise.all(
    ["home", "documents", "user-data"].map((name) => mkdir(join(root, name)))
  );
  for (const phase of ["capture", "restore", "default"]) {
    await new Promise((resolveRun, reject) => {
      const child = spawn(
        electron,
        [
          join(scripts, "fixtures/startup-window-smoke-main.mjs"),
          ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])
        ],
        {
          cwd: repository,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "",
            ELECTRON_RENDERER_URL: "",
            DEEPWRITE_SMOKE: "0",
            DEEPWRITE_STARTUP_WINDOW_SMOKE_ROOT: root,
            DEEPWRITE_STARTUP_WINDOW_SMOKE_PHASE: phase,
            DEEPWRITE_STARTUP_WINDOW_SMOKE_ENTRY: join(
              repository,
              "apps/desktop/out/main/index.js"
            )
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.resume();
      const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        try {
          assert.equal(code, 0, `Window smoke ${phase} failed: ${output}`);
          assert.ok(output.includes(`WINDOW_SIZE_OK ${phase}`), output);
          resolveRun();
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  console.log(
    "Startup window smoke passed: native capture, fixed size after resize, restart restoration and default reset through Preload and Main."
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
