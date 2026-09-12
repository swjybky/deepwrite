// Run with the repository Electron executable. Uses synthetic content in an isolated profile.
import { app, BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const output = process.argv[2];
if (!output) throw new Error("Provide a JSON result path.");
app.setPath(
  "userData",
  await mkdtemp(join(tmpdir(), "deepwrite-view-profile-"))
);
app.commandLine.appendSwitch("disable-background-timer-throttling");
void app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 900,
      height: 800,
      show: false,
      webPreferences: { backgroundThrottling: false }
    });
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures/conversation-view-probe.html"
    );
    const execute = (script) => window.webContents.executeJavaScript(script);
    const hash = (text) => ({
      length: text.length,
      sha256: createHash("sha256").update(text).digest("hex")
    });
    async function prepare(mode, count) {
      await window.loadFile(fixture);
      return execute(`prepareProbe(${JSON.stringify(mode)}, ${count})`);
    }
    const results = {
      versions: process.versions,
      performance: [],
      selection: []
    };
    try {
      for (const count of process.argv.includes("--selection-only")
        ? []
        : [100, 1000]) {
        for (const mode of ["baseline", "auto", "baseline", "auto"]) {
          const setup = await prepare(mode, count);
          const timing = await execute("measureProbe()");
          results.performance.push({ ...setup, ...timing });
          console.log(`Measured ${mode} ${count}`);
        }
      }
      for (const mode of ["baseline", "auto"]) {
        await prepare(mode, 1000);
        await execute(
          "document.querySelector('#scroller').tabIndex = 0; document.querySelector('#scroller').focus()"
        );
        window.webContents.focus();
        window.webContents.selectAll();
        await execute(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
        );
        const selectAll = hash(await execute("getSelection().toString()"));
        await prepare(mode, 1000);
        const range = hash(await execute("selectCrossHistoryRange()"));
        await prepare(mode, 1000);
        const find = await new Promise((resolve) => {
          const listen = (_event, result) => {
            if (!result.finalUpdate) return;
            window.webContents.removeListener("found-in-page", listen);
            resolve({
              matches: result.matches,
              activeMatchOrdinal: result.activeMatchOrdinal
            });
          };
          window.webContents.on("found-in-page", listen);
          window.webContents.findInPage("唯一定位标记_900_END");
        });
        results.selection.push({ mode, selectAll, range, find });
      }
      await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
      console.log(output);
    } finally {
      window.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
