import { open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { DESKTOP_APP_DIR, REPO_ROOT } from "./paths.mjs";

/** `pnpm dev` builds these once at startup and never reloads them. */
const BACKEND_SOURCES = [
  "apps/desktop/src/main",
  "apps/desktop/src/preload",
  "apps/desktop/src/utilities",
  "apps/desktop/src/extras",
  "packages/contracts/src",
  "packages/pi-runtime-adapter/src",
  "packages/shared/src"
];
const SOURCE_FILE = /\.(?:[cm]?[jt]s|json)$/u;
const TEST_FILE = /\.test(?:-support)?\.[cm]?[jt]s$/u;
const RESTART_LOG_ERRORS = [
  /Internal server error/iu,
  /Pre-transform error/iu,
  /\[vite\].*(?:error|failed)/iu,
  /render-process-gone/iu,
  /Error: Cannot find module/iu
];
const WARNING_LOG_ERRORS = [/\bUncaught\b/u, /\bTypeError\b/u, /\bError:/u];

export async function backendChangesSince(sinceMs, root = REPO_ROOT) {
  const changed = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
        if ((await stat(path)).mtimeMs > sinceMs) {
          changed.push(relative(root, path));
        }
      }
    }
  }
  for (const source of BACKEND_SOURCES) await walk(join(root, source));
  return changed.sort();
}

export async function readLogSince(file, offset = 0) {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const start = Math.min(offset, size);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

export function classifyLog(text) {
  const restart = [];
  const warnings = [];
  for (const line of text.split("\n")) {
    if (RESTART_LOG_ERRORS.some((pattern) => pattern.test(line))) {
      restart.push(line.trim());
    } else if (WARNING_LOG_ERRORS.some((pattern) => pattern.test(line))) {
      warnings.push(line.trim());
    }
  }
  return { restart: restart.slice(-20), warnings: warnings.slice(-20) };
}

export async function diagnose(status, state) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, ...detail });

  add("running", status.running, {});
  if (!status.running) {
    return {
      healthy: false,
      needsStart: true,
      needsRestart: false,
      reasons: ["测试实例没有运行"],
      checks
    };
  }
  add("electron", status.electron.pid !== undefined, {
    detail: status.electron
  });
  add("rendererReady", status.app?.rendererReady === true, {
    detail: status.app
  });
  add("cdp", status.cdpReachable, {});

  const reasons = [];
  if (!status.electron.pid) reasons.push("控制端点没有对应的 Electron 进程");
  if (status.app?.rendererReady !== true) reasons.push("窗口没有就绪");
  if (!status.cdpReachable) reasons.push("调试端口无法访问");

  const startedMs = Date.parse(state.startedAt);
  const changed = await backendChangesSince(startedMs);
  add("backendCurrent", changed.length === 0, {
    detail: { changedSinceStart: changed.slice(0, 30) }
  });
  if (changed.length > 0) {
    reasons.push(
      `启动后改过 ${changed.length} 个 Main / Preload / Utility / packages 文件，热更新不会加载`
    );
  }

  const readyMs = Date.parse(state.readyAt ?? state.startedAt);
  let outMs;
  try {
    outMs = (await stat(join(DESKTOP_APP_DIR, "out/main/index.js"))).mtimeMs;
  } catch {
    outMs = undefined;
  }
  const outRebuilt = outMs !== undefined && outMs > readyMs + 1_000;
  add("buildOutputCurrent", !outRebuilt, {});
  if (outRebuilt) {
    reasons.push(
      "启动后 out/ 被重新构建（跑过 pnpm build 或冒烟），新旧代码会混跑"
    );
  }

  const log = classifyLog(
    await readLogSince(state.logFile, state.logOffsetAtReady ?? 0)
  );
  add("logClean", log.restart.length === 0, {
    detail: { errors: log.restart, warnings: log.warnings }
  });
  if (log.restart.length > 0) {
    reasons.push("就绪后日志里出现热更新或加载错误");
  }

  return {
    healthy: reasons.length === 0,
    needsStart: false,
    needsRestart: reasons.length > 0,
    reasons,
    checks
  };
}
