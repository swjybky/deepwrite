import type {
  UtilityHealthPayload,
  UtilityWorkerName
} from "@deepwrite/contracts";
import { nowIso } from "@deepwrite/shared";

interface UtilityLifecycleOptions {
  mode: string | undefined;
  post(message: unknown): void;
  onStopping(): void;
  drain(): Promise<void>;
}

/** Main owns the save-then-stop sequence for its managed utilities. */
export function createUtilityLifecycle(
  worker: UtilityWorkerName,
  options: UtilityLifecycleOptions
) {
  const startedAt = nowIso();
  let lastHeartbeatAt = startedAt;
  let shuttingDown = false;
  let heartbeat: NodeJS.Timeout | undefined;

  function health(): UtilityHealthPayload {
    lastHeartbeatAt = nowIso();
    return {
      name: worker,
      status: shuttingDown ? "stopped" : "ok",
      pid: process.pid,
      startedAt,
      lastHeartbeatAt,
      details: {
        mode: options.mode ?? "foundation",
        uptimeMs: Math.round(process.uptime() * 1000)
      }
    };
  }

  async function shutdown(requestId: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    options.onStopping();
    try {
      await options.drain();
    } finally {
      try {
        options.post({
          kind: "utility.shutdown_ack",
          worker,
          requestId,
          timestamp: nowIso()
        });
      } finally {
        setTimeout(() => process.exit(0), 20).unref();
      }
    }
  }

  function start(): void {
    // Ctrl+C reaches Main and its children together. Core must still accept
    // the renderer's final writes until Main sends utility.shutdown. Keep a
    // persistent listener so another interrupt cannot restore Node's default
    // termination while a save is pending.
    process.on("SIGINT", () => undefined);
    // UtilitySupervisor's timeout/restart fallback uses child.kill() (SIGTERM).
    process.once("SIGTERM", () => void shutdown("signal_sigterm"));

    heartbeat = setInterval(() => {
      lastHeartbeatAt = nowIso();
      options.post({
        kind: "utility.heartbeat",
        worker,
        pid: process.pid,
        timestamp: lastHeartbeatAt
      });
    }, 5000);
    heartbeat.unref();
    options.post({
      kind: "utility.ready",
      worker,
      pid: process.pid,
      startedAt
    });
  }

  return { start, health, shutdown, isShuttingDown: () => shuttingDown };
}
