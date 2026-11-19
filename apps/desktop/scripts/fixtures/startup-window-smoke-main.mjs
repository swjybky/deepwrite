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

async function openAppearanceSettings() {
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };

  const trigger = await waitFor(
    () => globalThis.document.querySelector(".account-identity-button"),
    "Account trigger did not mount"
  );
  trigger.click();
  const settingsMenuItem = await waitFor(
    () =>
      Array.from(
        globalThis.document.querySelectorAll('#account-menu [role="menuitem"]')
      ).find((button) => /设置|Settings/i.test(button.textContent ?? "")),
    "Settings menu item did not render"
  );
  settingsMenuItem.click();
  const appearanceCategory = await waitFor(
    () =>
      Array.from(
        globalThis.document.querySelectorAll(".settings-category")
      ).find((button) => /外观|Appearance/i.test(button.textContent ?? "")),
    "Appearance category did not render"
  );
  appearanceCategory.click();
  await waitFor(() => {
    const fieldset = globalThis.document.querySelector(
      ".appearance-settings-content"
    );
    return (
      fieldset &&
      !fieldset.disabled &&
      globalThis.document.querySelector(".startup-window-settings")
    );
  }, "Startup window settings did not hydrate");
}

async function waitForPersistedSize(expected) {
  const api = globalThis.deepwrite.appearance;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = (await api.list()).settings.startupWindowSize;
    if (
      expected === null
        ? current === null
        : current?.width === expected.width &&
          current?.height === expected.height
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(
    `Timed out waiting for startupWindowSize=${JSON.stringify(expected)}`
  );
}

let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        await window.webContents.executeJavaScript(
          `(${openAppearanceSettings.toString()})()`
        );
        const area = screen.getPrimaryDisplay().workAreaSize;
        const bounds = window.getBounds();
        if (phase === "restore") {
          const saved = JSON.parse(
            await readFile(join(root, "expected.json"), "utf8")
          );
          assert.equal(bounds.width, saved.width);
          assert.equal(bounds.height, saved.height);
          const beforeState = await window.webContents
            .executeJavaScript(`(() => {
            const radios = document.querySelectorAll('.startup-window-settings [role="radio"]');
            return {
              label: document.querySelector('.startup-window-settings strong')?.textContent?.trim(),
              autoChecked: radios[0]?.getAttribute('aria-checked'),
              defaultChecked: radios[1]?.getAttribute('aria-checked')
            };
          })()`);
          assert.equal(beforeState.label, `${saved.width} × ${saved.height}`);
          assert.equal(beforeState.autoChecked, "true");
          assert.equal(beforeState.defaultChecked, "false");
          await window.webContents.executeJavaScript(`(async () => {
            const radios = document.querySelectorAll('.startup-window-settings [role="radio"]');
            radios[1].click();
          })()`);
          await window.webContents.executeJavaScript(
            `(${waitForPersistedSize.toString()})(null)`
          );
          window.setSize(
            Math.min(1300, area.width),
            Math.min(850, area.height)
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          const afterResizeInDefault =
            await window.webContents.executeJavaScript(
              "globalThis.deepwrite.appearance.list().then((snapshot) => snapshot.settings.startupWindowSize)"
            );
          assert.equal(afterResizeInDefault, null);
        } else {
          assert.equal(bounds.width, Math.min(1200, area.width));
          assert.equal(bounds.height, Math.min(800, area.height));
          if (phase === "capture") {
            window.setSize(
              Math.min(1400, area.width),
              Math.min(900, area.height)
            );
            const current = window.getBounds();
            const expected = { width: current.width, height: current.height };
            const saved = await window.webContents.executeJavaScript(
              `(${waitForPersistedSize.toString()})(${JSON.stringify(expected)})`
            );
            assert.deepEqual(saved, expected);
            const uiState = await window.webContents.executeJavaScript(`(() => {
              const radios = document.querySelectorAll('.startup-window-settings [role="radio"]');
              return {
                label: document.querySelector('.startup-window-settings strong')?.textContent?.trim(),
                autoChecked: radios[0]?.getAttribute('aria-checked')
              };
            })()`);
            assert.equal(
              uiState.label,
              `${expected.width} × ${expected.height}`
            );
            assert.equal(uiState.autoChecked, "true");
            await writeFile(join(root, "expected.json"), JSON.stringify(saved));
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
