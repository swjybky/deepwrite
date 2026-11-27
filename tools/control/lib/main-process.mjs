import { readState } from "./instance.mjs";
import { CliError } from "./output.mjs";
import { fetchJson } from "./processes.mjs";

function unavailable(message) {
  return new CliError("app.main_inspector_unavailable", message, {
    nextSteps: [
      "实例是旧版 CLI 启动的、没开主进程调试端口时，运行 pnpm -s ctl env restart"
    ]
  });
}

/**
 * Evaluates in the test instance's Main process through its Node inspector
 * (started with --inspect by env start). `require` comes from the inspector's
 * command-line API, since Main is an ES module.
 */
export async function evaluateInMain(
  layout,
  expression,
  { timeoutMs = 15_000 } = {}
) {
  const state = await readState(layout);
  if (!state?.inspectPort) throw unavailable("测试实例没有主进程调试端口。");
  const targets = await fetchJson(
    `http://127.0.0.1:${state.inspectPort}/json/list`
  );
  const target = Array.isArray(targets) ? targets[0] : undefined;
  if (!target?.webSocketDebuggerUrl)
    throw unavailable("连不上测试实例的主进程调试端口。");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        () => reject(unavailable("主进程调试端口拒绝连接。")),
        {
          once: true
        }
      );
    });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new CliError("app.main_timeout", "主进程在限定时间内没有返回。", {
              exitCode: 1,
              nextSteps: ["运行 pnpm -s ctl env doctor 检查实例状态"]
            })
          ),
        timeoutMs
      );
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            includeCommandLineAPI: true,
            awaitPromise: true,
            returnByValue: true
          }
        })
      );
    });
    const details = reply.result?.exceptionDetails;
    if (details) {
      throw new CliError("app.main_error", "主进程脚本出错。", {
        exitCode: 1,
        nextSteps: ["运行 pnpm -s ctl logs errors 查看主进程报错"],
        details: { exception: details.exception?.description ?? details.text }
      });
    }
    return reply.result?.result?.value;
  } finally {
    socket.close();
  }
}

/** Works when macOS has stopped painting the window (covered, other Space). */
export async function captureWindow(layout) {
  const value = await evaluateInMain(
    layout,
    `(async () => {
      const { BrowserWindow } = require("electron");
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && /^https?:/.test(candidate.webContents.getURL())
      );
      if (!window) return null;
      const image = await window.webContents.capturePage(undefined, { stayHidden: true });
      return image.toPNG().toString("base64");
    })()`
  );
  if (!value) {
    throw new CliError("ui.screenshot_failed", "主进程里找不到应用窗口。", {
      exitCode: 1,
      nextSteps: ["运行 pnpm -s ctl env doctor 检查实例状态"]
    });
  }
  return Buffer.from(value, "base64");
}
