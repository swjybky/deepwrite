import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(toolsDirectory, "..");
const appDirectory = resolve(workspaceRoot, "apps/desktop");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, cwd = workspaceRoot) {
  console.log(`PACKAGE_STEP command=${command} ${args.join(" ")}`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} 执行失败（exit=${String(code)}, signal=${String(signal)}）`
        )
      );
    });
  });
}

function parseTarget(args) {
  const [platform, arch] = args;
  if (platform === "all" && arch === undefined) {
    return { buildMacArm64: true, buildMacX64: true, buildWinX64: true };
  }
  if (platform === "mac" && arch === "all") {
    return { buildMacArm64: true, buildMacX64: true, buildWinX64: false };
  }
  if (platform === "mac" && arch === "arm64") {
    return { buildMacArm64: true, buildMacX64: false, buildWinX64: false };
  }
  if (platform === "mac" && arch === "x64") {
    return { buildMacArm64: false, buildMacX64: true, buildWinX64: false };
  }
  if (platform === "win" && arch === "x64") {
    return { buildMacArm64: false, buildMacX64: false, buildWinX64: true };
  }
  throw new Error(
    "Usage: node tools/run-test-package.mjs <all | mac arm64 | mac x64 | mac all | win x64>"
  );
}

async function electronVersion() {
  const packageJson = JSON.parse(
    await readFile(resolve(workspaceRoot, "node_modules/electron/package.json"), "utf8")
  );
  return packageJson.version;
}

async function buildMac(target, version) {
  const architectures = [
    ...(target.buildMacArm64 ? ["--arm64"] : []),
    ...(target.buildMacX64 ? ["--x64"] : [])
  ];
  if (!architectures.length) return;
  await run(
    pnpmCommand,
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      `--config.electronVersion=${version}`,
      "--mac",
      "dmg",
      ...architectures,
      "--publish",
      "never"
    ],
    appDirectory
  );
  if (target.buildMacArm64) {
    await run(pnpmCommand, ["exec", "node", "scripts/verify-test-package.mjs", "mac", "arm64"], appDirectory);
  }
  if (target.buildMacX64) {
    await run(pnpmCommand, ["exec", "node", "scripts/verify-test-package.mjs", "mac", "x64"], appDirectory);
  }
}

async function buildWindows(target, version) {
  if (!target.buildWinX64) return;
  await run(
    pnpmCommand,
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      `--config.electronVersion=${version}`,
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never"
    ],
    appDirectory
  );
  await run(pnpmCommand, ["exec", "node", "scripts/verify-test-package.mjs", "win", "x64"], appDirectory);
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  const initialRuntime = await ensureElectronRuntime();
  const version = await electronVersion();
  console.log(
    `PACKAGE_RUNTIME_BASELINE version=${version} executable=${initialRuntime.executable}`
  );

  let packagingError;
  try {
    await run(pnpmCommand, ["verify"]);
    await buildMac(target, version);
    await buildWindows(target, version);
  } catch (error) {
    packagingError = error;
  } finally {
    try {
      const finalRuntime = await ensureElectronRuntime();
      console.log(
        `PACKAGE_RUNTIME_POSTCHECK_OK version=${finalRuntime.version} executable=${finalRuntime.executable}`
      );
    } catch (runtimeError) {
      packagingError = packagingError
        ? new AggregateError(
            [packagingError, runtimeError],
            "测试包构建失败，并且 Electron 开发运行时恢复失败。"
          )
        : runtimeError;
    }
  }
  if (packagingError) throw packagingError;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
