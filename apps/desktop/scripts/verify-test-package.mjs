import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const releaseDir = join(appDir, "release");
const [targetPlatform, targetArch] = process.argv.slice(2);

if (
  !(
    (targetPlatform === "mac" && (targetArch === "arm64" || targetArch === "x64")) ||
    (targetPlatform === "win" && targetArch === "x64")
  )
) {
  console.error("Usage: node scripts/verify-test-package.mjs <mac arm64|mac x64|win x64>");
  process.exit(1);
}

const packageJson = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
const extension = targetPlatform === "mac" ? "dmg" : "exe";
const artifact = join(
  releaseDir,
  `DeepWrite-${packageJson.version}-${targetPlatform}-${targetArch}-test.${extension}`
);
const artifactStat = await stat(artifact);
if (!artifactStat.isFile() || artifactStat.size === 0) {
  throw new Error(`Test package is missing or empty: ${artifact}`);
}

if (targetPlatform === "mac") {
  const verification = spawnSync("hdiutil", ["verify", artifact], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (verification.status !== 0) {
    throw new Error(`DMG verification failed:\n${verification.stderr || verification.stdout}`);
  }
}

const hostCanRunTarget =
  (targetPlatform === "mac" && process.platform === "darwin") ||
  (targetPlatform === "win" && process.platform === "win32");

if (!hostCanRunTarget) {
  console.log(
    `PACKAGE_SMOKE_SKIPPED target=${targetPlatform}-${targetArch} host=${process.platform}-${process.arch} artifact=${artifact}`
  );
  process.exit(0);
}

const executable =
  targetPlatform === "mac"
    ? join(
        releaseDir,
        targetArch === "arm64" ? "mac-arm64" : "mac",
        "DeepWrite.app",
        "Contents",
        "MacOS",
        "DeepWrite"
      )
    : join(releaseDir, "win-unpacked", "DeepWrite.exe");
await stat(executable);

const smokeUserData = await mkdtemp(join(tmpdir(), "deepwrite-packaged-smoke-"));
let output = "";

try {
  const result = await new Promise((resolveResult) => {
    let timedOut = false;
    const child = spawn(executable, [`--user-data-dir=${smokeUserData}`], {
      cwd: appDir,
      env: {
        ...process.env,
        DEEPWRITE_SMOKE: "1",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolveResult({ code: null, signal: null, timedOut, error });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal, timedOut });
    });
  });

  if (result.error) {
    throw result.error;
  }
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));
  if (result.code !== 0 || !marker) {
    throw new Error(
      `Packaged app smoke failed with exit code ${String(result.code)}, signal ${String(result.signal)}, timedOut ${String(result.timedOut)}:\n${output}`
    );
  }

  const summary = JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
  if (
    summary.health?.status !== "ok" ||
    summary.health?.workers?.length !== 3 ||
    summary.agent?.status !== "ok" ||
    summary.agent?.runtime?.mode !== "local-faux" ||
    summary.agent?.completed !== true
  ) {
    throw new Error(`Packaged app returned an invalid smoke summary: ${JSON.stringify(summary)}`);
  }

  console.log(
    `PACKAGE_TEST_OK target=${targetPlatform}-${targetArch} bytes=${artifactStat.size} artifact=${artifact}`
  );
} finally {
  await rm(smokeUserData, { recursive: true, force: true });
}
