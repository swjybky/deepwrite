import assert from "node:assert/strict";
import { app, dialog, screen } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.DEEPWRITE_STARTUP_WINDOW_SMOKE_ROOT;
const phase = process.env.DEEPWRITE_STARTUP_WINDOW_SMOKE_PHASE;
const entry = process.env.DEEPWRITE_STARTUP_WINDOW_SMOKE_ENTRY;
if (!root || !entry || !["capture", "restore", "default"].includes(phase))
  throw new Error("Missing isolated window smoke configuration.");
app.setPath("home", join(root, "home"));
app.setPath("documents", join(root, "documents"));
app.setPath("userData", join(root, "user-data"));
app.setPath("sessionData", join(root, "user-data"));
process.env.DEEPWRITE_DEV_USER_DATA = join(root, "user-data");
globalThis.fetch = async () => {
  throw new Error("Network disabled for window smoke.");
};
dialog.showErrorBox = () => {
  console.log("WINDOW_SIZE_STARTUP_FAILED");
  app.exit(1);
};

async function updateSize(capture) {
  const api = globalThis.deepwrite.appearance;
  const settings = (await api.list()).settings;
  if (capture)
    return (await api.save(settings, { captureCurrentWindowSize: true }))
      .settings.startupWindowSize;
  await api.save({ ...settings, startupWindowSize: null });
}

let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        // Let the application's load listeners settle before the fixture can exit.
        await new Promise((resolve) => setImmediate(resolve));
        const area = screen.getPrimaryDisplay().workAreaSize;
        const bounds = window.getBounds();
        if (phase === "restore") {
          const saved = JSON.parse(
            await readFile(join(root, "expected.json"), "utf8")
          );
          assert.equal(bounds.width, saved.width);
          assert.equal(bounds.height, saved.height);
          await window.webContents.executeJavaScript(
            `(${updateSize.toString()})(false)`
          );
        } else {
          assert.equal(bounds.width, Math.min(1200, area.width));
          assert.equal(bounds.height, Math.min(800, area.height));
          if (phase === "capture") {
            window.setSize(
              Math.min(1400, area.width),
              Math.min(900, area.height)
            );
            const current = window.getBounds();
            const saved = await window.webContents.executeJavaScript(
              `(${updateSize.toString()})(true)`
            );
            assert.deepEqual(saved, {
              width: current.width,
              height: current.height
            });
            await writeFile(join(root, "expected.json"), JSON.stringify(saved));
            window.setSize(
              Math.min(1200, area.width),
              Math.min(800, area.height)
            );
            const after = await window.webContents.executeJavaScript(
              "(async () => { const api = globalThis.deepwrite.appearance; const settings = (await api.list()).settings; return (await api.save({ ...settings, mode: 'dark' })).settings.startupWindowSize; })()"
            );
            assert.deepEqual(after, saved);
          }
        }
        console.log(`WINDOW_SIZE_OK ${phase}`);
        app.exit(0);
      } catch (error) {
        console.log(`WINDOW_SIZE_FAILED ${error.message}`);
        app.exit(1);
      }
    })();
  });
});
await import(pathToFileURL(entry).href);
