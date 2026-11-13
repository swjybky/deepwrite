import assert from "node:assert/strict";
import { app, dialog, net, session } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { documentVersionsSmokeInRenderer } from "./document-versions-smoke-renderer.mjs";
import { assertElectronLaunchAllowed } from "../../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();
const root = process.env.DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_ROOT;
const entry = process.env.DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_ENTRY;
const phase = process.env.DEEPWRITE_DOCUMENT_VERSIONS_SMOKE_PHASE;
if (!root || !entry || !["seed", "reopen"].includes(phase))
  throw new Error("Missing isolated document versions smoke configuration.");
for (const name of [
  "home",
  "documents",
  "appData",
  "userData",
  "sessionData"
]) {
  const directory =
    name === "appData"
      ? "app-data"
      : ["userData", "sessionData"].includes(name)
        ? "user-data"
        : name;
  app.setPath(name, join(root, directory));
}
process.env.DEEPWRITE_DEV_USER_DATA = join(root, "user-data");
const offline = async () => {
  throw new Error("Network disabled for document versions smoke.");
};
globalThis.fetch = offline;
net.fetch = offline;
app.once("ready", () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );
});
dialog.showErrorBox = () => {
  console.log("DOCUMENT_VERSIONS_SMOKE_FAILED startup");
  app.exit(1);
};

let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(app.getPath("userData"), join(root, "user-data"));
        const saved =
          phase === "reopen"
            ? JSON.parse(await readFile(join(root, "expected.json"), "utf8"))
            : null;
        const result = await window.webContents.executeJavaScript(
          `(${documentVersionsSmokeInRenderer.toString()})(${JSON.stringify({ phase, saved })})`
        );
        if (phase === "seed")
          await writeFile(join(root, "expected.json"), JSON.stringify(result));
        console.log(
          `DOCUMENT_VERSIONS_SMOKE_OK ${phase} ${JSON.stringify(result.checks)}`
        );
        app.quit();
      } catch (error) {
        console.log(
          `DOCUMENT_VERSIONS_SMOKE_FAILED ${error.message ?? error.code ?? "unknown"}`
        );
        app.exit(1);
      }
    })();
  });
});
await import(pathToFileURL(entry).href);
