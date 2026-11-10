import assert from "node:assert/strict";
import { app, dialog, net } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.DEEPWRITE_CONFIGURATION_SMOKE_ROOT;
const phase = process.env.DEEPWRITE_CONFIGURATION_SMOKE_PHASE;
const entry = process.env.DEEPWRITE_CONFIGURATION_SMOKE_ENTRY;
if (!root || !entry || !["formal", "development"].includes(phase))
  throw new Error("Missing isolated configuration smoke paths.");

const name = "DeepWriteConfigurationSmoke";
const appData = join(root, "app-data");
const formalPath = join(appData, name);
app.setName(name);
app.setPath("home", join(root, "home"));
app.setPath("documents", join(root, "documents"));
app.setPath("appData", appData);
app.setPath("userData", formalPath);
app.setPath("sessionData", formalPath);
process.env.DEEPWRITE_DEV_USER_DATA = phase === "formal" ? formalPath : "";
process.env.DEEPWRITE_LEGACY_PROJECT_DATA_ROOT = join(root, "legacy");

const fetcher = async (input, init) => {
  if (String(input) !== "https://models.example.test/v1/models")
    throw new Error("Network is disabled for configuration smoke.");
  assert.equal(
    new Headers(init?.headers).get("authorization"),
    "Bearer invalid-configuration-smoke-placeholder"
  );
  return new Response(JSON.stringify({ data: [{ id: "smoke-writer" }] }), {
    headers: { "content-type": "application/json" }
  });
};
globalThis.fetch = fetcher;
net.fetch = fetcher;

function record(status) {
  console.log(`DEEPWRITE_CONFIGURATION_SMOKE ${phase}:${status}`);
}
app.once("ready", () => record("native-ready"));
dialog.showErrorBox = (_title, message) => {
  const known = [
    "迁移",
    "加密",
    "事务",
    "目录",
    "服务",
    "workspace",
    "runtime"
  ];
  record(
    `startup-failed-${known.find((word) => message.includes(word)) ?? "unknown"}`
  );
  app.exit(1);
};

async function inRenderer(phase) {
  const api = globalThis.deepwrite;
  const check = (value, stage) => {
    if (!value) throw new Error(`Configuration smoke: ${stage}`);
  };
  const model = {
    id: "configuration-smoke-model",
    label: "Formal model",
    provider: "custom",
    modelId: "smoke-writer",
    api: "openai-completions",
    baseUrl: "https://models.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.1, 0.7, 1]
  };
  const stateKey = "conversation-preferences:configuration-smoke";
  const browserKey = "configuration-smoke";
  if (phase === "formal") {
    await api.models.save({
      models: [{ ...model, apiKey: "invalid-configuration-smoke-placeholder" }],
      defaultModelId: model.id
    });
    const settings = (await api.generalSettings.list()).settings;
    await api.generalSettings.save({ ...settings, showContextUsage: false });
    await api.conversationPersistence.save(stateKey, { owner: "formal" });
    localStorage.setItem(browserKey, "formal");
    return;
  }
  const snapshot = await api.models.list();
  check(
    snapshot.models.find((entry) => entry.id === model.id)?.hasApiKey,
    "key-reference"
  );
  check(snapshot.defaultModelId === model.id, "default-model");
  check(
    !(await api.generalSettings.list()).settings.showContextUsage,
    "general-settings"
  );
  check(
    (await api.conversationPersistence.load(stateKey)) == null,
    "private-conversation"
  );
  check(localStorage.getItem(browserKey) === null, "private-browser-storage");
  // No draft key: Main must decrypt the credential saved by the other process.
  const remote = await api.models.listRemote(model);
  check(
    remote.models.some((entry) => entry.id === "smoke-writer"),
    "decrypted-key"
  );
  await api.models.save({
    models: [{ ...model, label: "Development model" }],
    defaultModelId: model.id
  });
  await api.conversationPersistence.save(stateKey, { owner: "development" });
  localStorage.setItem(browserKey, "development");
}

async function verifyFormal() {
  const api = globalThis.deepwrite;
  const models = await api.models.list();
  if (
    models.models.find((entry) => entry.id === "configuration-smoke-model")
      ?.label !== "Development model" ||
    (
      await api.conversationPersistence.load(
        "conversation-preferences:configuration-smoke"
      )
    ).owner !== "formal" ||
    localStorage.getItem("configuration-smoke") !== "formal"
  )
    throw new Error("Shared configuration or private runtime was lost.");
}

let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  record("window-created");
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        assert.equal(
          app.getPath("userData"),
          phase === "formal" ? formalPath : `${formalPath}-dev`
        );
        await window.webContents.executeJavaScript(
          `(${inRenderer.toString()})(${JSON.stringify(phase)})`
        );
        record("ready");
        if (phase === "formal") {
          await new Promise((resolve) => {
            const timer = setInterval(() => {
              if (existsSync(join(root, "finish"))) {
                clearInterval(timer);
                resolve();
              }
            }, 50);
          });
          await window.webContents.executeJavaScript(
            `(${verifyFormal.toString()})()`
          );
          record("verified");
        }
        app.quit();
      } catch (error) {
        // Do not print provider errors, request details or configuration files.
        const message = error instanceof Error ? error.message : "";
        record(
          message.startsWith("Configuration smoke: ")
            ? `failed-${message.slice(21)}`
            : "failed"
        );
        app.exit(1);
      }
    })();
  });
});

await import(pathToFileURL(entry).href);
record("imported");
