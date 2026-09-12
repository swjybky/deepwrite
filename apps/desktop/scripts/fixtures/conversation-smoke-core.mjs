import assert from "node:assert/strict";
import { utilityProcess } from "electron";

/** Actual Core Utility transport, including shutdown acknowledgement and exit. */
export async function startConversationSmokeCore(entry, profile, nonce) {
  const child = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      DEEPWRITE_USER_DATA_PATH: profile,
      DEEPWRITE_MAIN_INSTANCE_ID: nonce
    },
    stdio: "pipe"
  });
  let sequence = 0;
  const pending = new Map();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const deadline = setTimeout(() => readyResolve(false), 10_000);
  child.on("message", (message) => {
    if (message.kind === "utility.ready") readyResolve(true);
    if (message.requestId) pending.get(message.requestId)?.(message);
  });
  child.on("exit", () => {
    readyResolve(false);
    for (const settle of pending.values()) settle({ kind: "exited" });
  });
  try {
    assert.equal(await ready, true, "Core did not become ready");
  } finally {
    clearTimeout(deadline);
  }
  function request(message) {
    const requestId = `conversation_smoke_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Core request timed out: ${message.kind}`));
      }, 15_000);
      pending.set(requestId, (result) => {
        clearTimeout(timeout);
        pending.delete(requestId);
        if (result.kind === "exited")
          reject(new Error("Core exited during request"));
        else resolve(result);
      });
      child.postMessage({ ...message, requestId });
    });
  }
  return {
    async command(type, payload) {
      const id = `command_${sequence + 1}`;
      const response = await request({
        kind: "utility.command.request",
        command: {
          protocolVersion: 1,
          id,
          type,
          timestamp: new Date().toISOString(),
          context: { correlationId: id },
          payload
        }
      });
      assert.equal(response.kind, "utility.command.result");
      assert.equal(
        response.result.status,
        "accepted",
        response.result.error?.message
      );
      return response.result.payload;
    },
    async close() {
      const result = await request({ kind: "utility.shutdown" });
      assert.equal(result.kind, "utility.shutdown_ack");
      assert.equal(await exited, 0);
    },
    async crash() {
      process.kill(child.pid, "SIGKILL");
      await exited;
    }
  };
}
