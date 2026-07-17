import { access } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(appDir, "../..");
const electronBinary = resolve(workspaceRoot, "node_modules/electron/dist/electron");

try {
  await access(resolve(appDir, "out/main/index.js"));
  await access(electronBinary);
} catch {
  console.error("Desktop build or Electron binary is missing. Run `pnpm build` first.");
  process.exit(1);
}

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const hasXvfb = spawnSync("sh", ["-c", "command -v xvfb-run"], { encoding: "utf8" }).status === 0;
const command = !hasDisplay && hasXvfb ? "xvfb-run" : electronBinary;
const args = !hasDisplay && hasXvfb
  ? ["-a", electronBinary, ".", "--no-sandbox"]
  : [".", "--no-sandbox"];

const child = spawn(command, args, {
  cwd: appDir,
  env: {
    ...process.env,
    DEEPWRITE_SMOKE: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill("SIGKILL");
}, 20_000);

child.on("close", (code) => {
  clearTimeout(timeout);
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));

  if (code !== 0 || !marker) {
    console.error(output.trim());
    console.error(`Electron smoke failed with exit code ${String(code)}.`);
    process.exit(1);
  }

  const summary = JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
  if (summary.health?.status !== "ok" || summary.health?.workers?.length !== 3) {
    console.error(`Electron smoke returned unhealthy utilities: ${JSON.stringify(summary)}`);
    process.exit(1);
  }

  if (
    summary.agent?.status !== "ok" ||
    summary.agent?.runtime?.mode !== "local-faux" ||
    summary.agent?.deltaCount < 2 ||
    summary.agent?.thinkingDeltaCount < 1 ||
    summary.agent?.completed !== true
  ) {
    console.error(`Electron smoke returned an invalid agent summary: ${JSON.stringify(summary)}`);
    process.exit(1);
  }

  console.log("Electron smoke passed: utilities are healthy and Pi/Faux thinking + text streamed to completion.");
});
