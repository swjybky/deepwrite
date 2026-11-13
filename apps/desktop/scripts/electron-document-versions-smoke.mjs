import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";

assertElectronLaunchAllowed();
const scripts = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scripts, "../../..");
const entry = join(repository, "apps/desktop/out/main/index.js");
await access(entry);
const binary = join(
  repository,
  "node_modules/electron/dist",
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron"
);
const root = await realpath(
  await mkdtemp(join(tmpdir(), "deepwrite-document-versions-smoke-"))
);
try {
  await Promise.all(
    ["home", "documents", "user-data", "legacy", "app-data"].map((name) =>
      mkdir(join(root, name))
    )
  );
  await prepareSmokeWorkspace(join(root, "user-data"));
  for (const phase of ["seed", "reopen"]) {
    await new Promise((resolveRun, reject) => {
      const child = spawn(
        binary,
        [
          join(scripts, "fixtures/document-versions-smoke-main.mjs"),
          ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])
        ],
        {
          cwd: repository,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "",
            ELECTRON_RENDERER_URL: "",
            DEEPWRITE_SMOKE: "0",
            DEEPWRITE_STORAGE_SMOKE: "",
            DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_ROOT: root,
            DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_PHASE: phase,
            DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_ENTRY: entry,
            DEEPWRITE_LEGACY_PROJECT_DATA_ROOT: join(root, "legacy")
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
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        try {
          assert.equal(
            code,
            0,
            `Document versions smoke ${phase} failed: ${output}`
          );
          const marker = output
            .split(/\r?\n/u)
            .find((line) =>
              line.startsWith(`DOCUMENT_VERSIONS_SMOKE_OK ${phase} `)
            );
          assert.ok(marker, output);
          console.log(marker);
          resolveRun();
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  console.log(
    "Document versions smoke passed: actual Main, sandboxed Preload, Core, same-run merging, restore, conflict, setting gates, rename and restart persistence."
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
