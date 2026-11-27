import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();

const [, , kind, output, electronFlag, fixtureUrl] = process.argv;
const fixtures = { style: "Style", long: "Long" };
if (!fixtures[kind] || !output)
  throw new Error("Expected style|long and output directory");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const suffix = fixtures[kind];

if (electronFlag === "--electron") {
  const { app, BrowserWindow } = await import("electron");
  app.setPath(
    "userData",
    await mkdtemp(join(tmpdir(), `analysis-${kind}-profile-`))
  );
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      webPreferences: { backgroundThrottling: false }
    });
    const errors = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    const execute = (script) =>
      Promise.race([
        win.webContents.executeJavaScript(script),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Probe timed out")),
            30000
          );
          timer.unref();
        })
      ]);
    try {
      await mkdir(output, { recursive: true });
      await win.loadURL(fixtureUrl);
      await execute(
        `new Promise(resolve => { const timer = setInterval(() => { if (window.run${suffix}AnalysisProbe) { clearInterval(timer); resolve(); } }, 20); })`
      );
      const interactions = await execute(`run${suffix}AnalysisProbe()`);
      const samples = [];
      for (const [scheme, size, width, height, processOpen] of [
        ["light", 14, 1200, 900, false],
        ["dark", 14, 1200, 900, false],
        ["light", 24, 640, 800, false],
        ["dark", 24, 640, 800, false],
        ["light", 14, 1200, 900, true],
        ["dark", 24, 640, 800, true]
      ]) {
        win.setContentSize(width, height);
        samples.push(
          await execute(
            `show${suffix}AnalysisProbe('${scheme}', ${size}, ${processOpen})`
          )
        );
        await writeFile(
          join(
            output,
            `${scheme}-${size}-${processOpen ? "process" : "page"}.png`
          ),
          (await win.capturePage()).toPNG()
        );
      }
      for (const [scheme, size, width, height] of [
        ["light", 14, 1200, 900],
        ["dark", 24, 640, 800]
      ]) {
        win.setContentSize(width, height);
        await execute(
          `show${suffix}AnalysisProbe('${scheme}', ${size}, false)`
        );
        samples.push(
          await execute(`(async () => {
          const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const trigger = document.querySelector('.analysis-model-trigger');
          if (!trigger || trigger.disabled) throw new Error('Model settings must be available after a run');
          trigger.click();
          await frame();
          const panel = document.querySelector('.analysis-model-panel');
          if (!panel) throw new Error('Model settings panel did not open');
          await new Promise(resolve => setTimeout(resolve, 150));
          await frame();
          const rect = panel.getBoundingClientRect();
          if (rect.left < 0 || rect.right > innerWidth + 1 || rect.top < 0 || rect.bottom > innerHeight + 1 || panel.scrollWidth > panel.clientWidth + 1)
            throw new Error('Model settings must fit the viewport');
          const option = panel.querySelector('.model-picker-list [role="option"]');
          if (!option) throw new Error('Model list options did not render');
          const optRect = option.getBoundingClientRect();
          if (!panel.contains(document.elementFromPoint(optRect.left + 10, optRect.top + 10)))
            throw new Error('Model picker option must be clickable inside the panel');
          return { scheme: '${scheme}', size: ${size}, modelSettings: true, menuAbovePanel: true };
        })()`)
        );
        await writeFile(
          join(output, `${scheme}-${size}-model-settings.png`),
          (await win.capturePage()).toPNG()
        );
        await execute(`(async () => {
          const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const panel = document.querySelector('.analysis-model-panel');
          if (!panel) throw new Error('Model settings panel closed unexpectedly');
          panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await frame();
          if (document.querySelector('.analysis-model-panel') || document.activeElement !== document.querySelector('.analysis-model-trigger'))
            throw new Error('Closing settings must restore the trigger focus');
        })()`);
      }
      if (errors.length) throw new Error(errors.join("\n"));
      await writeFile(
        join(output, "result.json"),
        JSON.stringify({ interactions, samples }, null, 2)
      );
      console.log(JSON.stringify({ kind, interactions, samples }));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      win.destroy();
      app.exit(process.exitCode ?? 0);
    }
  });
} else {
  const { createServer } = await import("vite");
  const { default: vue } = await import("@vitejs/plugin-vue");
  const require = createRequire(import.meta.url);
  const server = await createServer({
    root,
    configFile: false,
    publicDir: resolve(root, "apps/desktop/src/renderer/public"),
    plugins: [vue()],
    server: { port: 0, hmr: false },
    resolve: {
      alias: [
        {
          find: "@deepwrite/contracts/renderer",
          replacement: resolve(root, "packages/contracts/src/renderer.ts")
        }
      ]
    }
  });
  try {
    await server.listen();
    const url = new URL(
      `apps/desktop/scripts/fixtures/${kind}-analysis-probe.html`,
      server.resolvedUrls.local[0]
    );
    await new Promise((resolve, reject) => {
      const child = spawn(
        require("electron"),
        [fileURLToPath(import.meta.url), kind, output, "--electron", url.href],
        { stdio: "inherit" }
      );
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`Electron probe exited: ${signal ?? code}`))
      );
    });
  } finally {
    await server.close();
  }
}
