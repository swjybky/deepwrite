import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertElectronLaunchAllowed } from "../../electron-launch-environment.mjs";
import { openControlSession, readControlState } from "./control-client.mjs";
import { CliError } from "./output.mjs";
import {
  DESKTOP_APP_DIR,
  REPO_ROOT,
  assertInsideTestEnvironment
} from "./paths.mjs";
import {
  commandLine,
  fetchJson,
  freePort,
  isAlive,
  waitUntil
} from "./processes.mjs";

const LAUNCHER = join(REPO_ROOT, "tools/run-desktop-dev.mjs");

export async function readState(layout) {
  try {
    return JSON.parse(await readFile(layout.stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeState(layout, state) {
  const target = assertInsideTestEnvironment(layout, layout.stateFile);
  await mkdir(layout.root, { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

function isLauncher(pid) {
  return commandLine(pid)?.includes("run-desktop-dev.mjs") ?? false;
}

function isElectron(pid) {
  return /electron/iu.test(commandLine(pid) ?? "");
}

async function appStatus(layout) {
  try {
    const session = await openControlSession(layout, { timeoutMs: 5_000 });
    try {
      return await session.call("get_app_status");
    } finally {
      session.close();
    }
  } catch (error) {
    return { error: error.code ?? error.message };
  }
}

/** The developer's own `pnpm dev`, reported read-only and never touched. */
async function developerInstance() {
  const state = await readControlState(
    join(homedir(), ".deepwrite/control-dev/control.json")
  );
  return {
    running: Boolean(state?.pid && isAlive(state.pid)),
    ...(state?.pid && isAlive(state.pid) ? { pid: state.pid } : {})
  };
}

export async function instanceStatus(layout) {
  const state = await readState(layout);
  const control = await readControlState(layout.controlState);
  const launcherAlive = Boolean(state && isLauncher(state.launcherPid));
  const electronPid = control?.pid;
  const electronAlive = Boolean(
    launcherAlive && electronPid && isElectron(electronPid)
  );
  const app =
    electronAlive && control?.status === "ready"
      ? await appStatus(layout)
      : undefined;
  const cdp =
    electronAlive && state?.cdpPort
      ? await fetchJson(`http://127.0.0.1:${state.cdpPort}/json/version`)
      : undefined;
  return {
    env: layout.name,
    root: layout.root,
    seeded: await exists(join(layout.config, "general-settings.json")),
    running: launcherAlive,
    ready: Boolean(app?.rendererReady && cdp),
    ...(state
      ? {
          launcherPid: state.launcherPid,
          startedAt: state.startedAt,
          readyAt: state.readyAt,
          cdpPort: state.cdpPort,
          inspectPort: state.inspectPort,
          viteUrl: state.viteUrl,
          logFile: state.logFile
        }
      : {}),
    electron: electronAlive
      ? { pid: electronPid, controlStatus: control.status }
      : { running: false },
    app: app ?? { error: "not_running" },
    cdpReachable: Boolean(cdp),
    developerInstance: await developerInstance()
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readLogTail(file, lines = 40) {
  try {
    return (await readFile(file, "utf8")).split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function viteUrlFrom(log) {
  return log.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/u)?.[0];
}

export async function startInstance(layout, { timeoutMs }) {
  if (process.platform === "win32") {
    throw new CliError(
      "env.unsupported_platform",
      "测试实例目前只支持 macOS 和 Linux。",
      { nextSteps: ["在 macOS 上运行，或改用 pnpm smoke 做无界面验证"] }
    );
  }
  try {
    assertElectronLaunchAllowed();
  } catch (error) {
    throw new CliError("env.sandbox_blocked", error.message, {
      nextSteps: [
        "从系统终端运行，或为这条命令申请沙盒外执行",
        "不要在沙盒内反复重试；被拦下的验证记为未验"
      ]
    });
  }
  if (!(await exists(join(layout.config, "general-settings.json")))) {
    throw new CliError("env.not_seeded", "测试环境还没准备配置。", {
      nextSteps: ["运行 pnpm -s ctl env seed 复制模型与登录"]
    });
  }
  const current = await instanceStatus(layout);
  if (current.running) {
    if (current.ready) return { ...current, reused: true };
    throw new CliError(
      "env.running_unhealthy",
      "测试实例在运行但没有就绪，不能直接复用。",
      {
        nextSteps: [
          "运行 pnpm -s ctl env doctor 查看原因",
          "运行 pnpm -s ctl env restart 重启"
        ],
        details: { app: current.app, cdpReachable: current.cdpReachable }
      }
    );
  }

  const ensure = spawnSync(
    process.execPath,
    [join(REPO_ROOT, "tools/ensure-electron-runtime.mjs")],
    { cwd: DESKTOP_APP_DIR, encoding: "utf8" }
  );
  if (ensure.status !== 0) {
    throw new CliError("env.electron_missing", "Electron 运行时不可用。", {
      nextSteps: ["运行 pnpm install 后重试"],
      details: { output: `${ensure.stdout}${ensure.stderr}`.slice(-2_000) }
    });
  }

  for (const directory of [layout.logs, layout.control, layout.workspace]) {
    await mkdir(assertInsideTestEnvironment(layout, directory), {
      recursive: true
    });
  }
  await rm(assertInsideTestEnvironment(layout, layout.controlState), {
    force: true
  });
  const cdpPort = await freePort();
  // Main's own inspector: only Main can capture a window macOS stopped
  // painting (fully covered or on another Space).
  const inspectPort = await freePort();
  const startedAt = new Date().toISOString();
  const logFile = join(
    layout.logs,
    `dev-${startedAt.replace(/[:.]/gu, "-")}.log`
  );
  const output = openSync(assertInsideTestEnvironment(layout, logFile), "a");
  const environment = {
    ...process.env,
    DEEPWRITE_DEV_USER_DATA: layout.profile,
    DEEPWRITE_CONTROL_DIR: layout.control,
    DEEPWRITE_TEST_ENV: "1"
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    process.execPath,
    [
      LAUNCHER,
      "--remoteDebuggingPort",
      String(cdpPort),
      "--inspect",
      String(inspectPort)
    ],
    {
      cwd: DESKTOP_APP_DIR,
      env: environment,
      detached: true,
      stdio: ["ignore", output, output]
    }
  );
  closeSync(output);
  child.unref();
  const state = {
    launcherPid: child.pid,
    startedAt,
    cdpPort,
    inspectPort,
    logFile
  };
  await writeState(layout, state);

  const ready = await waitUntil(
    async () => {
      if (!isAlive(child.pid)) return { exited: true };
      const status = await instanceStatus(layout);
      return status.ready ? status : undefined;
    },
    { timeoutMs, intervalMs: 1_000 }
  );
  if (!ready || ready.exited) {
    const tail = await readLogTail(logFile);
    throw new CliError(
      ready?.exited ? "env.start_exited" : "env.start_timeout",
      ready?.exited
        ? "测试实例启动后立即退出了。"
        : `测试实例在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪。`,
      {
        nextSteps: [
          "查看 details.logTail 里的报错并修复",
          ready?.exited
            ? "修复后重新运行 pnpm -s ctl env start"
            : "运行 pnpm -s ctl env stop 清理后重试，或加大 --timeout"
        ],
        details: { logFile, logTail: tail }
      }
    );
  }
  const log = await readFile(logFile, "utf8");
  await writeState(layout, {
    ...state,
    readyAt: new Date().toISOString(),
    logOffsetAtReady: Buffer.byteLength(log),
    viteUrl: viteUrlFrom(log)
  });
  return { ...(await instanceStatus(layout)), reused: false };
}

async function signal(pid, name) {
  try {
    process.kill(pid, name);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export async function stopInstance(layout, { timeoutMs = 30_000 } = {}) {
  const state = await readState(layout);
  const control = await readControlState(layout.controlState);
  const launcherPid =
    state && isLauncher(state.launcherPid) ? state.launcherPid : undefined;
  const electronPid =
    launcherPid && control?.pid && isElectron(control.pid)
      ? control.pid
      : undefined;
  if (!launcherPid) {
    if (state) await rm(layout.stateFile, { force: true });
    return { stopped: false, reason: "not_running" };
  }
  // The launcher forwards SIGINT to electron-vite's process group, the same
  // graceful path as Ctrl+C in a terminal, so Electron saves before exiting.
  await signal(launcherPid, "SIGINT");
  const gone = () =>
    !isAlive(launcherPid) && !(electronPid && isAlive(electronPid));
  let forced = false;
  if (!(await waitUntil(gone, { timeoutMs }))) {
    forced = true;
    if (electronPid) await signal(electronPid, "SIGTERM");
    await signal(launcherPid, "SIGTERM");
    if (!(await waitUntil(gone, { timeoutMs: 10_000 }))) {
      if (electronPid) await signal(electronPid, "SIGKILL");
      await signal(launcherPid, "SIGKILL");
    }
  }
  await rm(assertInsideTestEnvironment(layout, layout.stateFile), {
    force: true
  });
  return { stopped: true, forced, launcherPid, electronPid };
}

/** Removal targets for reset: everything the app wrote, except its configuration. */
export async function resetTargets(layout) {
  const list = async (directory, keep = new Set()) => {
    try {
      return (await readdir(directory))
        .filter((name) => !keep.has(name))
        .map((name) =>
          assertInsideTestEnvironment(layout, join(directory, name))
        );
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };
  const ledger = join(layout.root, "fixtures.json");
  return [
    ...(await list(layout.profile, new Set(["config"]))),
    ...(await list(layout.workspace)),
    ...(await list(layout.control)),
    ...((await exists(ledger)) ? [ledger] : [])
  ];
}

export async function removeInside(layout, targets) {
  for (const target of targets) {
    await rm(assertInsideTestEnvironment(layout, target), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    });
  }
}

export async function assertStopped(layout, action) {
  const state = await readState(layout);
  if (state && isLauncher(state.launcherPid)) {
    throw new CliError("env.running", `测试实例正在运行，不能${action}。`, {
      nextSteps: ["先运行 pnpm -s ctl env stop"]
    });
  }
}
