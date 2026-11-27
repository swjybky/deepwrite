import { chromium } from "playwright-core";
import { readState } from "./instance.mjs";
import { CliError } from "./output.mjs";
import { isAlive } from "./processes.mjs";

function unavailable(message, details) {
  return new CliError("app.cdp_unavailable", message, {
    nextSteps: [
      "运行 pnpm -s ctl env doctor 检查实例状态",
      "实例没在运行时运行 pnpm -s ctl env start"
    ],
    ...(details ? { details } : {})
  });
}

/**
 * Playwright attaches to the test instance's real window over its debugging
 * port. Closing a connectOverCDP browser only disconnects; the app keeps
 * running.
 */
export async function connectPage(layout, { timeoutMs = 15_000 } = {}) {
  const state = await readState(layout);
  if (!state?.cdpPort || !isAlive(state.launcherPid)) {
    throw unavailable("测试实例没有运行，调试端口不可用。");
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${state.cdpPort}`,
      { timeout: timeoutMs }
    );
  } catch (error) {
    throw unavailable("无法连接测试实例的调试端口。", {
      reason: error.message.split("\n")[0]
    });
  }
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page =
    pages.find(
      (candidate) => state.viteUrl && candidate.url().startsWith(state.viteUrl)
    ) ?? pages.find((candidate) => !candidate.url().startsWith("devtools://"));
  if (!page) {
    await browser.close();
    throw unavailable("调试端口上找不到应用窗口。", { port: state.cdpPort });
  }
  page.setDefaultTimeout(timeoutMs);
  const size = await page
    .evaluate("({ inner: innerWidth, outer: outerWidth })")
    .catch(() => undefined);
  if (size && Math.abs(size.outer - size.inner) > 40) {
    await browser.close();
    // A CDP session that died mid-emulation leaves its metrics on the real
    // window; only a restart clears them.
    throw new CliError(
      "app.window_emulated",
      `窗口可视区域被残留的调试仿真改成了 ${size.inner} 宽（窗口实际 ${size.outer}）。`,
      {
        nextSteps: ["运行 pnpm -s ctl env restart"],
        details: size
      }
    );
  }
  return {
    page,
    url: page.url(),
    /** Runs a JavaScript expression; a thrown error becomes `exception`. */
    async evaluate(expression) {
      try {
        return { value: await page.evaluate(expression) };
      } catch (error) {
        return { exception: error.message.split("\n")[0] };
      }
    },
    async close() {
      await browser.close();
    }
  };
}
