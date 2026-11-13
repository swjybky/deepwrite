import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();
const root = fileURLToPath(new URL("../../..", import.meta.url));
const output =
  process.argv[2] ?? join(tmpdir(), "deepwrite-document-versions-probe");
if (process.argv.includes("--electron")) {
  const { app, BrowserWindow } = await import("electron");
  const profile = await mkdtemp(join(tmpdir(), "deepwrite-versions-profile-"));
  app.setPath("userData", profile);
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      webPreferences: { backgroundThrottling: false }
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    try {
      await mkdir(output, { recursive: true });
      await win.loadFile(process.argv[4]);
      await win.webContents.executeJavaScript(
        "new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(window.runDocumentVersionsProbe){clearInterval(timer);resolve();}else if(Date.now()-start>15000){clearInterval(timer);reject(new Error('Fixture timeout'));}},20);})"
      );
      const interactions = await win.webContents.executeJavaScript(
        "runDocumentVersionsProbe()"
      );
      const samples = [];
      for (const scheme of ["light", "dark"]) {
        for (const [size, width, height] of [
          [14, 1200, 900],
          [24, 1000, 680]
        ]) {
          win.setContentSize(width, height);
          for (const state of [
            "empty",
            "unversioned",
            "diff",
            "full",
            "confirm"
          ]) {
            const metrics = await win.webContents.executeJavaScript(
              `showDocumentVersionsProbe('${scheme}',${size},'${state}')`
            );
            if (
              metrics.overflow ||
              metrics.top < 0 ||
              metrics.bottom > height + 1
            )
              throw new Error(
                `Version dialog exceeds viewport: ${JSON.stringify(metrics)}`
              );
            samples.push({ scheme, size, state, ...metrics });
            await writeFile(
              join(output, `${scheme}-${size}-${state}.png`),
              (await win.capturePage()).toPNG()
            );
          }
        }
      }
      await writeFile(
        join(output, "result.json"),
        JSON.stringify({ interactions, samples }, null, 2)
      );
      console.log(JSON.stringify({ output, interactions, samples }));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      win.destroy();
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50
      });
      app.exit(process.exitCode ?? 0);
    }
  });
} else {
  const { build } = await import("vite");
  const { default: vue } = await import("@vitejs/plugin-vue");
  const require = createRequire(import.meta.url);
  const buildDir = await mkdtemp(join(tmpdir(), "deepwrite-versions-build-"));
  try {
    await build({
      root,
      publicDir: resolve(root, "apps/desktop/src/renderer/public"),
      configFile: false,
      base: "./",
      plugins: [vue()],
      resolve: {
        alias: [
          {
            find: "@deepwrite/contracts/renderer",
            replacement: resolve(root, "packages/contracts/src/renderer.ts")
          },
          {
            find: /^@deepwrite\/contracts$/,
            replacement: resolve(root, "packages/contracts/src/renderer.ts")
          }
        ]
      },
      build: {
        outDir: buildDir,
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(
            root,
            "apps/desktop/scripts/fixtures/document-versions-probe.html"
          )
        }
      }
    });
    const child = spawn(
      require("electron"),
      [
        fileURLToPath(import.meta.url),
        output,
        "--electron",
        join(
          buildDir,
          "apps/desktop/scripts/fixtures/document-versions-probe.html"
        )
      ],
      { stdio: "inherit" }
    );
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`Electron probe exited: ${signal ?? code}`))
      );
    });
  } finally {
    await rm(buildDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
}
