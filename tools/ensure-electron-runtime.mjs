import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function expectedElectronExecutable() {
  if (process.platform === "darwin") {
    return "Electron.app/Contents/MacOS/Electron";
  }
  if (process.platform === "win32") {
    return "electron.exe";
  }
  return "electron";
}

function isContained(root, candidate) {
  const offset = relative(root, candidate);
  return (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  );
}

export function resolveElectronPackageDirectory() {
  return dirname(require.resolve("electron/package.json"));
}

export async function inspectElectronRuntime(
  packageDirectory = resolveElectronPackageDirectory()
) {
  const packageJson = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8")
  );
  const expectedExecutable = expectedElectronExecutable();
  let configuredExecutable;
  try {
    configuredExecutable = (await readFile(join(packageDirectory, "path.txt"), "utf8")).trim();
  } catch {
    return {
      healthy: false,
      packageDirectory,
      version: packageJson.version,
      reason: "electron/path.txt 不存在"
    };
  }
  if (configuredExecutable !== expectedExecutable) {
    return {
      healthy: false,
      packageDirectory,
      version: packageJson.version,
      reason: `electron/path.txt 指向 ${configuredExecutable || "空路径"}，当前主机需要 ${expectedExecutable}`
    };
  }

  const distDirectory = resolve(packageDirectory, "dist");
  const executable = resolve(distDirectory, configuredExecutable);
  if (!isContained(distDirectory, executable)) {
    return {
      healthy: false,
      packageDirectory,
      version: packageJson.version,
      reason: "electron/path.txt 指向了 dist 目录之外"
    };
  }
  try {
    const installedVersion = (await readFile(join(distDirectory, "version"), "utf8"))
      .trim()
      .replace(/^v/u, "");
    if (installedVersion !== packageJson.version) {
      return {
        healthy: false,
        packageDirectory,
        version: packageJson.version,
        reason: `Electron 二进制版本为 ${installedVersion}，依赖版本为 ${packageJson.version}`
      };
    }
    await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  } catch {
    return {
      healthy: false,
      packageDirectory,
      version: packageJson.version,
      reason: `Electron ${packageJson.version} 可执行文件不存在或不可执行`
    };
  }
  return {
    healthy: true,
    packageDirectory,
    version: packageJson.version,
    executable
  };
}

function runNodeScript(script, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script], {
      cwd: dirname(script),
      env,
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
          `Electron 安装脚本失败（exit=${String(code)}, signal=${String(signal)}）`
        )
      );
    });
  });
}

export async function ensureElectronRuntime({ repair = true } = {}) {
  const initial = await inspectElectronRuntime();
  if (initial.healthy) return initial;
  if (!repair) {
    throw new Error(`Electron 开发运行时不可用：${initial.reason}`);
  }

  console.warn(`Electron 开发运行时需要修复：${initial.reason}`);
  const installScript = join(initial.packageDirectory, "install.js");
  const installEnv = { ...process.env };
  delete installEnv.ELECTRON_OVERRIDE_DIST_PATH;
  delete installEnv.npm_config_platform;
  delete installEnv.npm_config_arch;
  delete installEnv.npm_config_target_platform;
  delete installEnv.npm_config_target_arch;
  installEnv.ELECTRON_INSTALL_PLATFORM = process.platform;
  installEnv.ELECTRON_INSTALL_ARCH = process.arch;
  await runNodeScript(installScript, installEnv);

  const repaired = await inspectElectronRuntime(initial.packageDirectory);
  if (!repaired.healthy) {
    throw new Error(`Electron 开发运行时修复后仍不可用：${repaired.reason}`);
  }
  console.log(
    `ELECTRON_RUNTIME_REPAIRED version=${repaired.version} executable=${repaired.executable}`
  );
  return repaired;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const runtime = await ensureElectronRuntime({ repair: !checkOnly });
  console.log(
    `ELECTRON_RUNTIME_OK version=${runtime.version} executable=${runtime.executable}`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
