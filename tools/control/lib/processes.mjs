import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function commandLine(pid) {
  if (!isAlive(pid)) return undefined;
  const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
    encoding: "utf8"
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export async function waitUntil(check, { timeoutMs, intervalMs = 500 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) return undefined;
    await delay(intervalMs);
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function fetchJson(url, timeoutMs = 2_000) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}
