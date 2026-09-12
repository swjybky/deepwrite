import { app, ipcMain, utilityProcess } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.DEEPWRITE_SHUTDOWN_SMOKE_ROOT;
const profile = process.env.DEEPWRITE_SHUTDOWN_SMOKE_PROFILE;
if (!root || !profile)
  throw new Error("Missing isolated shutdown smoke paths.");
app.setPath("userData", profile);
app.setPath("documents", join(profile, "documents"));

function record(type, details = {}) {
  console.log(
    `DEEPWRITE_SHUTDOWN_SMOKE ${JSON.stringify({ type, ...details })}`
  );
}

app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (event, _level, message) => {
    const text = event.message ?? message ?? "";
    if (/Failed to fetch dynamically imported module/.test(text))
      record("module-failed");
    if (/service.*stopped|service.*running/i.test(text))
      record("compiler-stopped");
  });
});

let rendererReady = false;
let announcedReady = false;
let forks = 0;
const readyWorkers = new Set();
function announceReady() {
  if (announcedReady || !rendererReady || readyWorkers.size !== 3) return;
  announcedReady = true;
  record("ready");
}

const fork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (...args) => {
  const child = fork(...args);
  forks += 1;
  child.on("message", (message) => {
    if (message.kind === "utility.ready") {
      readyWorkers.add(message.worker);
      announceReady();
    }
  });
  return child;
};

const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (event, command, ...rest) => {
    if (command?.type === "rendererState.flushCompleted") {
      if (command.payload.ok) {
        // Even an empty workspace must exercise a new durable write AFTER
        // Ctrl+C. Give the child's signal handler time to run first.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const save = await listener(event, {
          ...command,
          id: "shutdown_smoke_final_save",
          type: "rendererState.save",
          payload: {
            key: "conversation-preferences:shutdown-smoke",
            value: { draft: "pending shutdown draft" }
          }
        });
        record("save", { status: save.status });
        command = {
          ...command,
          payload: { ...command.payload, ok: save.status === "accepted" }
        };
      }
      record("flush", { ok: command.payload.ok });
    }
    const result = await listener(event, command, ...rest);
    if (
      command?.type === "rendererState.flushReady" &&
      command.payload.enabled &&
      result.status === "accepted"
    ) {
      rendererReady = true;
      announceReady();
    }
    return result;
  });

app.on("before-quit", () => record("before-quit"));
app.on("quit", (_event, code) => record("quit", { code, forks }));
await import(pathToFileURL(join(root, "apps/desktop/out/main/index.js")).href);
