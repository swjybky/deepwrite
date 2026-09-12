import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("electron-vite")), "cli.js");
if (process.platform === "win32") {
  // Windows has no POSIX process groups. Keep electron-vite's native console
  // handling rather than using child.kill(), which force-terminates on Windows.
  process.argv = [process.execPath, cli, "dev", ...process.argv.slice(2)];
  await import(pathToFileURL(cli).href);
} else {
  runIsolatedDevelopment();
}

function runIsolatedDevelopment() {
  let lastInterruptAt = -Infinity;
  let child;

  function interrupt() {
    const now = Date.now();
    if (now - lastInterruptAt < 1_000) return;
    lastInterruptAt = now;
    if (!child?.pid) return;
    try {
      // pnpm follows Ctrl+C with child termination. Keep the actual dev session
      // in its own group and coalesce that burst into one graceful interrupt.
      // A later Ctrl+C can retry if Electron canceled exit after a save error.
      process.kill(-child.pid, "SIGINT");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  child = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2)], {
    detached: true,
    stdio: "inherit"
  });
  child.once("error", (error) => {
    console.error(
      `Unable to start desktop development: ${error.code ?? "spawn_failed"}`
    );
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}
