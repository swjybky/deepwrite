import {
  EXTERNAL_CONTROL_MESSAGE_MAX_BYTES,
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlResultSchema,
  createEnvelope,
  type ExternalControlClient,
  type ExternalControlResult,
  type ExternalControlStateFile
} from "@deepwrite/contracts/external-control";
import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { AppLaunch } from "./bridge-launch";
import { ExternalControlError } from "./errors";
import { createLineReader, encodeLine } from "./line-framing";

const CONNECT_TIMEOUT_MS = 3_000;
const LAUNCH_WAIT_MS = 20_000;
const LAUNCH_POLL_MS = 200;
/** Answers before a client's own 60 second tool timeout hides the reason. */
const CALL_TIMEOUT_MS = 50_000;

interface BridgeConnectionOptions {
  readState(): Promise<ExternalControlStateFile | undefined>;
  launch(): AppLaunch;
  client(): ExternalControlClient;
  isProcessAlive?: (pid: number) => boolean;
  launchWaitMs?: number;
  launchPollMs?: number;
  callTimeoutMs?: number;
}

interface PendingCall {
  resolve(result: ExternalControlResult): void;
  reject(error: Error): void;
}

interface Session {
  request(id: string, message: unknown): Promise<ExternalControlResult>;
  close(): void;
  closed(): boolean;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM still proves that a process with this id exists.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function appUnavailable(detail?: string): ExternalControlError {
  return new ExternalControlError(
    "external.app_unavailable",
    `无法连接 DeepWrite${detail ? `（${detail}）` : ""}。请让用户手动打开软件后重试。`
  );
}

function disabled(): ExternalControlError {
  return new ExternalControlError(
    "external.disabled",
    "DeepWrite 未允许外部智能体操作。请让用户到“设置 → 外部智能体”打开“允许外部智能体操作软件”。"
  );
}

function openSocket(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createSession(socket: Socket, timeoutMs: number): Session {
  const pending = new Map<string, PendingCall>();
  let isClosed = false;

  const settleAll = (): void => {
    isClosed = true;
    for (const call of pending.values()) call.reject(appUnavailable());
    pending.clear();
  };
  const reader = createLineReader({
    maxBytes: () => EXTERNAL_CONTROL_MESSAGE_MAX_BYTES,
    onLine: (line) => {
      let parsed;
      try {
        parsed = ExternalControlResultSchema.safeParse(JSON.parse(line));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const call = pending.get(parsed.data.requestId);
      pending.delete(parsed.data.requestId);
      call?.resolve(parsed.data);
    },
    onOverflow: () => socket.destroy()
  });
  socket.on("data", (chunk: Buffer) => reader.push(chunk));
  socket.on("error", () => socket.destroy());
  socket.on("close", settleAll);

  return {
    request(id, message) {
      if (isClosed) return Promise.reject(appUnavailable());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new ExternalControlError(
              "external.not_ready",
              "DeepWrite 响应超时。请稍后重试。"
            )
          );
        }, timeoutMs);
        pending.set(id, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
        socket.write(encodeLine(message));
      });
    },
    close: () => socket.destroy(),
    closed: () => isClosed
  };
}

function throwRejection(
  result: Extract<ExternalControlResult, { status: "rejected" }>
): never {
  throw new ExternalControlError(result.error.code, result.error.message);
}

export function createBridgeConnection(options: BridgeConnectionOptions) {
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const launchWaitMs = options.launchWaitMs ?? LAUNCH_WAIT_MS;
  const launchPollMs = options.launchPollMs ?? LAUNCH_POLL_MS;
  const callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  let session: Session | undefined;
  let opening: Promise<Session> | undefined;

  /** Undefined means the state is stale and the app must be started. */
  async function tryState(
    state: ExternalControlStateFile | undefined
  ): Promise<Session | undefined> {
    if (!state || !isAlive(state.pid)) return undefined;
    if (state.status === "disabled") throw disabled();
    let socket: Socket;
    try {
      socket = await openSocket(state.endpoint);
    } catch {
      return undefined;
    }
    const candidate = createSession(socket, callTimeoutMs);
    const id = randomUUID();
    const welcome = await candidate.request(
      id,
      createEnvelope(
        "externalControl.hello",
        {
          protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
          token: state.token,
          client: options.client()
        },
        { id }
      )
    );
    if (welcome.status === "rejected") {
      candidate.close();
      throwRejection(welcome);
    }
    return candidate;
  }

  async function open(): Promise<Session> {
    const existing = await tryState(await options.readState());
    if (existing) return existing;

    let launch: AppLaunch;
    try {
      launch = options.launch();
    } catch (error: unknown) {
      throw appUnavailable(error instanceof Error ? error.message : undefined);
    }
    const deadline = Date.now() + launchWaitMs;
    while (Date.now() < deadline) {
      await delay(launchPollMs);
      const failure = launch.failure();
      if (failure) throw appUnavailable(failure);
      const started = await tryState(await options.readState());
      if (started) return started;
    }
    throw appUnavailable("启动超时");
  }

  function ensureSession(): Promise<Session> {
    if (session && !session.closed()) return Promise.resolve(session);
    opening ??= open()
      .then((created) => {
        session = created;
        return created;
      })
      .finally(() => {
        opening = undefined;
      });
    return opening;
  }

  return {
    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
      const active = await ensureSession();
      const id = randomUUID();
      const result = await active.request(
        id,
        createEnvelope(
          "externalControl.call",
          { tool, arguments: args },
          { id }
        )
      );
      if (result.status === "rejected") throwRejection(result);
      return result.payload;
    },
    close(): void {
      session?.close();
      session = undefined;
    }
  };
}
