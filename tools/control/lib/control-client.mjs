import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { CliError } from "./output.mjs";

const PROTOCOL_VERSION = 1;
export const CLIENT_NAME = "deepwrite-ctl";

function envelope(type, payload) {
  const id = randomUUID();
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    type,
    timestamp: new Date().toISOString(),
    context: { correlationId: id },
    payload
  };
}

export async function readControlState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** One connection per CLI command; the app keeps no CLI session state. */
export async function openControlSession(layout, { timeoutMs = 10_000 } = {}) {
  const state = await readControlState(layout.controlState);
  if (state?.status !== "ready") {
    throw new CliError(
      "app.control_unavailable",
      "测试实例的控制接口还没就绪。",
      {
        nextSteps: ["运行 pnpm -s ctl env status 查看实例状态"],
        details: { controlStatus: state?.status ?? "missing" }
      }
    );
  }
  // The endpoint comes from the test environment's own control.json, so the
  // developer's dev instance and the installed app are never reachable here.
  const socket = connect(state.endpoint);
  const pending = new Map();
  let buffer = "";
  let closedError;
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(message.requestId);
      if (waiter) {
        pending.delete(message.requestId);
        waiter.resolve(message);
      }
    }
  });
  const failAll = (error) => {
    closedError = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  socket.on("error", (error) =>
    failAll(
      new CliError("app.control_unavailable", "无法连接测试实例的控制接口。", {
        nextSteps: ["运行 pnpm -s ctl env doctor 检查实例是否需要重启"],
        details: { reason: error.code ?? error.message }
      })
    )
  );
  socket.on("close", () =>
    failAll(
      new CliError("app.control_closed", "测试实例关闭了控制连接。", {
        nextSteps: ["运行 pnpm -s ctl env doctor 检查实例状态"]
      })
    )
  );

  function request(message, timeout = timeoutMs) {
    if (closedError) return Promise.reject(closedError);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id);
        reject(
          new CliError(
            "app.control_timeout",
            "控制接口在限定时间内没有回应。",
            {
              nextSteps: [
                "运行 pnpm -s ctl env doctor 检查实例状态",
                "长任务请加大 --timeout"
              ],
              details: { type: message.type, timeoutMs: timeout }
            }
          )
        );
      }, timeout);
      pending.set(message.id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.write(`${JSON.stringify(message)}\n`);
    });
  }

  const hello = await request(
    envelope("externalControl.hello", {
      protocolVersion: PROTOCOL_VERSION,
      token: state.token,
      client: { name: CLIENT_NAME }
    })
  );
  if (hello.status !== "accepted") {
    socket.destroy();
    throw new CliError(
      "app.control_refused",
      `控制接口拒绝连接：${hello.error?.message ?? "未知原因"}`,
      {
        nextSteps:
          hello.error?.code === "external.approval_pending"
            ? [
                "测试配置缺少客户端批准记录：运行 pnpm -s ctl env stop 后 env seed 再 env start"
              ]
            : ["运行 pnpm -s ctl env doctor 检查实例状态"],
        details: { code: hello.error?.code }
      }
    );
  }

  return {
    pid: state.pid,
    async call(tool, args = {}, options = {}) {
      const result = await request(
        envelope("externalControl.call", { tool, arguments: args }),
        options.timeoutMs
      );
      if (result.status === "accepted") return result.payload;
      throw new CliError(
        "app.tool_rejected",
        `工具 ${tool} 被拒绝：${result.error?.message ?? "未知原因"}`,
        {
          exitCode: 1,
          nextSteps: ["按错误信息修正参数后重试"],
          details: { tool, code: result.error?.code }
        }
      );
    },
    close() {
      socket.end();
    }
  };
}
