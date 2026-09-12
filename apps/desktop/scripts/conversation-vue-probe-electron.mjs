import { app, BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , output, url] = process.argv;
app.setPath(
  "userData",
  await mkdtemp(join(tmpdir(), "deepwrite-vue-profile-"))
);
void app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      show: false,
      webPreferences: { backgroundThrottling: false }
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    const execute = (script) =>
      Promise.race([
        win.webContents.executeJavaScript(script),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Probe operation timeout")),
            30_000
          );
          timer.unref();
        })
      ]);
    const hash = (text) => ({
      length: text.length,
      sha256: createHash("sha256").update(text).digest("hex")
    });
    const twoFrames =
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))";
    const results = { versions: process.versions, samples: [] };
    try {
      if (process.argv.includes("--management-only")) {
        await win.loadURL(url);
        win.webContents.focus();
        await execute(
          "new Promise(resolve => { const timer = setInterval(() => { if (window.runManagementProbe) { clearInterval(timer); resolve(); } }, 10); })"
        );
        const result = await execute("runManagementProbe()");
        console.log(JSON.stringify(result));
        await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
        await writeFile(
          output.replace(/\.json$/, ".png"),
          (await win.capturePage()).toPNG()
        );
        return;
      }
      for (const turns of process.argv.includes("--interactions-only")
        ? [1000]
        : [10, 100, 1000])
        for (const enabled of process.argv.includes("--interactions-only")
          ? [true]
          : [false, true, false, true]) {
          await win.loadURL(url);
          win.webContents.focus();
          await execute(
            "new Promise((resolve, reject) => { const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Fixture load timeout')); }, 15000); const timer = setInterval(() => { if (window.prepareVueProbe) { clearTimeout(timeout); clearInterval(timer); resolve(); } }, 10); })"
          );
          const setup = await execute(`prepareVueProbe(${turns}, ${enabled})`);
          const metrics = await execute("measureVueProbe()");
          await execute(
            "document.querySelector('.conversation-scroll').tabIndex = -1; document.querySelector('.conversation-scroll').focus();"
          );
          win.webContents.selectAll();
          await execute(twoFrames);
          const nativeSelection = hash(
            await execute("getSelection().toString()")
          );
          const selection = await execute("selectVueHistory()");
          const interactions =
            turns === 1000 && enabled
              ? await execute("verifyVueInteractions()")
              : undefined;
          results.samples.push({
            ...setup,
            ...metrics,
            interactions,
            selection: hash(selection),
            nativeSelection
          });
          if (
            Math.abs(metrics.lockedDelta) > 1 ||
            Math.abs(metrics.navigationOffset - 22) > 2
          )
            throw new Error("Scroll follow or navigation regression");
          if (
            interactions &&
            (!interactions.focusExempt ||
              !interactions.editingExempt ||
              !interactions.selectionExempt ||
              !interactions.referenceInserted ||
              !interactions.activeGroupExempt ||
              [...interactions.anchorDeltas, ...interactions.widthDeltas].some(
                (item) => Math.abs(item.delta) > 1
              ))
          )
            throw new Error(
              `Interaction regression: ${JSON.stringify(interactions)}`
            );
          console.log(JSON.stringify(results.samples.at(-1)));
        }
      for (const count of new Set(
        results.samples.map((sample) => sample.turns)
      )) {
        const samples = results.samples.filter(
          (sample) => sample.turns === count
        );
        for (const key of ["selection", "nativeSelection"])
          if (new Set(samples.map((sample) => sample[key].sha256)).size !== 1)
            throw new Error(
              `Native selection differs for ${count} turns (${key})`
            );
      }
      if (process.argv.includes("--interactions-only"))
        await writeFile(
          output.replace(/\.json$/, ".png"),
          (await win.capturePage()).toPNG()
        );
      await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
    } finally {
      win.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
