import { spawn } from "node:child_process";
import { pnpmInvocation } from "./pnpm-command.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";
import { assertElectronLaunchAllowed } from "./electron-launch-environment.mjs";
import { resolveWindowsElectronArchive } from "./windows-electron-archive.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(toolsDirectory, "..");
const appDirectory = resolve(workspaceRoot, "apps/desktop");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, cwd = workspaceRoot) {
  console.log(`PACKAGE_STEP command=${command} ${args.join(" ")}`);
  return new Promise((resolvePromise, rejectPromise) => {
    const invocation =
      command === pnpmCommand ? pnpmInvocation(args) : { command, args };
    const child = spawn(invocation.command, invocation.args, {
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

export function parseTarget(args) {
  const targets = {
    all: ["buildLinuxX64", "buildMacArm64", "buildMacX64", "buildWinX64"],
    desktop: ["buildMacArm64", "buildMacX64", "buildWinX64"],
    "mac all": ["buildMacArm64", "buildMacX64"],
    "mac arm64": ["buildMacArm64"],
    "mac x64": ["buildMacX64"],
    "win x64": ["buildWinX64"],
    "win arm64": ["buildWinArm64"],
    "linux x64": ["buildLinuxX64"],
    "linux arm64": ["buildLinuxArm64"],
    "arch x64": ["buildArchX64"]
  };
  const selected = Object.hasOwn(targets, args.join(" "))
    ? targets[args.join(" ")]
    : undefined;
  if (!selected) {
    throw new Error(
      "Usage: node tools/run-test-package.mjs <all | desktop | linux x64 | linux arm64 | arch x64 | mac arm64 | mac x64 | mac all | win x64 | win arm64>"
    );
  }
  return Object.fromEntries(
    [
      "buildLinuxX64",
      "buildLinuxArm64",
      "buildArchX64",
      "buildMacArm64",
      "buildMacX64",
      "buildWinX64",
      "buildWinArm64"
    ].map((target) => [target, selected.includes(target)])
  );
}

async function electronVersion() {
  const packageJson = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "node_modules/electron/package.json"),
      "utf8"
    )
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
      "zip",
      ...architectures,
      "--publish",
      "never"
    ],
    appDirectory
  );
  if (target.buildMacArm64) {
    await run(
      pnpmCommand,
      ["exec", "node", "scripts/verify-test-package.mjs", "mac", "arm64"],
      appDirectory
    );
  }
  if (target.buildMacX64) {
    await run(
      pnpmCommand,
      ["exec", "node", "scripts/verify-test-package.mjs", "mac", "x64"],
      appDirectory
    );
  }
}

async function buildWindows(arch, version, archive) {
  if (!arch) return;
  await run(
    pnpmCommand,
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      `--config.electronVersion=${version}`,
      ...(arch === "arm64" ? ["--config.publish.channel=latest-arm64"] : []),
      ...(archive ? [`--config.electronDist=${archive}`] : []),
      "--win",
      "nsis",
      `--${arch}`,
      "--publish",
      "never"
    ],
    appDirectory
  );
  await run(
    pnpmCommand,
    ["exec", "node", "scripts/verify-test-package.mjs", "win", arch],
    appDirectory
  );
}

/** Build AppImage, deb and pacman for the requested architecture; pacman-only keeps the Arch x64 target. */
async function buildLinuxPackage(arch, { pacmanOnly = false }, version) {
  await run(
    pnpmCommand,
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      `--config.electronVersion=${version}`,
      ...(arch === "arm64"
        ? ["--config.publish.channel=latest-linux-arm64"]
        : []),
      "--linux",
      ...(pacmanOnly ? ["pacman"] : ["AppImage", "deb", "pacman"]),
      `--${arch}`,
      "--publish",
      "never"
    ],
    appDirectory
  );
  await run(
    pnpmCommand,
    [
      "exec",
      "node",
      "scripts/verify-test-package.mjs",
      pacmanOnly ? "arch" : "linux",
      arch
    ],
    appDirectory
  );
}

async function buildLinux(target, version) {
  if (target.buildArchX64)
    await buildLinuxPackage("x64", { pacmanOnly: true }, version);
  else if (target.buildLinuxX64) await buildLinuxPackage("x64", {}, version);
  else if (target.buildLinuxArm64)
    await buildLinuxPackage("arm64", {}, version);
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  const windowsArch = target.buildWinArm64
    ? "arm64"
    : target.buildWinX64
      ? "x64"
      : undefined;
  if (
    target.buildMacArm64 ||
    (target.buildMacX64 && process.env.DEEPWRITE_SKIP_MAC_X64_SMOKE !== "1")
  ) {
    assertElectronLaunchAllowed();
  }
  const initialRuntime = await ensureElectronRuntime();
  const version = await electronVersion();
  console.log(
    `PACKAGE_RUNTIME_BASELINE version=${version} executable=${initialRuntime.executable}`
  );

  let packagingError;
  try {
    const windowsArchive = windowsArch
      ? await resolveWindowsElectronArchive(version, { arch: windowsArch })
      : undefined;
    await run(pnpmCommand, ["verify"]);
    await buildLinux(target, version);
    await buildMac(target, version);
    await buildWindows(windowsArch, version, windowsArchive);
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

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    );
    process.exitCode = 1;
  });
}
