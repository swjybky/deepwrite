import {
  EXTERNAL_CONTROL_MESSAGE_MAX_BYTES,
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlResultSchema,
  ExternalRestartAppInputSchema,
  ExternalRestartAppResultSchema,
  GetAppStatusResultSchema,
  createEnvelope,
  findExternalControlTool,
  type ExternalControlClient,
  type ExternalControlResult,
  type ExternalControlStateFile,
  type ExternalRestartAppResult,
  type GetAppStatusResult
} from "@deepwrite/contracts/external-control";
import { isRecord } from "@deepwrite/shared";
import { isNodeError } from "@deepwrite/shared/node";
import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { AppLaunch } from "./bridge-launch";
import { ExternalControlError } from "./errors";
import { createLineReader, encodeLine } from "./line-framing";

const CONNECT_TIMEOUT_MS = 3_000;
const LAUNCH_WAIT_MS = 30_000;
const LAUNCH_POLL_MS = 200;
/** Answers before a client's own 60 second tool timeout hides the reason. */
const CALL_TIMEOUT_MS = 50_000;
/** An installer that never finishes must not keep the app closed for good. */
const UPDATE_HOLD_MS = 10 * 60_000;
const RESTART_HOLD_MS = 35_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const IDLE_CHECK_MS = 2_000;
const PING_TIMEOUT_MS = 2_000;
const RESTART_EXIT_WAIT_MS = 15_000;
const RELAUNCH_GRACE_MS = 4_000;
const READY_WAIT_MS = 8_000;
const READY_POLL_MS = 300;
const SOCKET_KEEPALIVE_MS = 15_000;
const TERMINATE_GRACE_MS = 3_000;

interface BridgeConnectionOptions {
  readState(): Promise<ExternalControlStateFile | undefined>;
  launch(): AppLaunch;
  client(): ExternalControlClient;
  isProcessAlive?: (pid: number) => boolean;
  terminateProcess?: (pid: number) => Promise<void>;
  launchWaitMs?: number;
  launchPollMs?: number;
  callTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  idleCheckMs?: number;
  restartWaitMs?: number;
  restartExitWaitMs?: number;
  relaunchGraceMs?: number;
  readyWaitMs?: number;
  now?: () => number;
}

interface PendingCall {
  resolve(result: ExternalControlResult): void;
  reject(error: Error): void;
}

interface Session {
  request(
    id: string,
    message: unknown,
    customTimeoutMs?: number
  ): Promise<ExternalControlResult>;
  enableHeartbeat(): void;
  verifyAlive(maxIdleMs: number): Promise<boolean>;
  close(): void;
  closed(): boolean;
}

type ReadyState = Extract<ExternalControlStateFile, { status: "ready" }>;

class SessionTransportError extends ExternalControlError {
  constructor(
    readonly beforeWrite: boolean,
    detail?: string
  ) {
    super(
      "external.app_unavailable",
      `无法连接 DeepWrite${detail ? `（${detail}）` : ""}。请让用户手动打开软件后重试。`
    );
  }
}

class SessionTimeoutError extends ExternalControlError {
  constructor() {
    super("external.not_ready", "DeepWrite 响应超时。请稍后重试。");
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM still proves that a process with this id exists.
    return isNodeError(error, "EPERM");
  }
}

async function defaultTerminateProcess(
  pid: number,
  isAlive: (pid: number) => boolean,
  pollMs: number
): Promise<void> {
  if (pid <= 1 || pid === process.pid) {
    throw new ExternalControlError(
      "external.not_ready",
      "当前进程无法安全强制重启。请手动重启 DeepWrite 后重试。"
    );
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error: unknown) {
    if (isNodeError(error, "ESRCH")) return;
    if (isNodeError(error, "EPERM")) {
      throw new ExternalControlError(
        "external.not_ready",
        "没有权限强制重启正在运行的 DeepWrite。请手动重启后重试。"
      );
    }
    throw error;
  }
  const waitExit = async (waitMs: number): Promise<boolean> => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return true;
      await delay(Math.min(pollMs, 100));
    }
    return !isAlive(pid);
  };
  if (await waitExit(TERMINATE_GRACE_MS)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error: unknown) {
    if (isNodeError(error, "ESRCH")) return;
    throw error;
  }
  await waitExit(2_000);
}

function appUnavailable(detail?: string): ExternalControlError {
  return new ExternalControlError(
    "external.app_unavailable",
    `无法连接 DeepWrite${detail ? `（${detail}）` : ""}。请让用户手动打开软件后重试。`
  );
}

/** Reopening the app now would lock its files and undo the update. */
export class AppUpdatingError extends ExternalControlError {
  constructor() {
    super(
      "external.app_unavailable",
      "DeepWrite 正在安装更新，暂时不能操作。请等待更新完成、用户重新打开 DeepWrite 后再试。"
    );
  }
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
    const onError = (error: Error) => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      clearTimeout(timer);
      socket.off("error", onError);
      socket.setNoDelay(true);
      try {
        socket.setKeepAlive(true, SOCKET_KEEPALIVE_MS);
      } catch {
        /* Named pipes do not support TCP keepalive. */
      }
      resolve(socket);
    };
    const timer = setTimeout(() => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.on("error", () => undefined);
      socket.destroy();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function createSession(
  socket: Socket,
  options: {
    timeoutMs: number;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
  }
): Session {
  const pending = new Map<string, PendingCall>();
  let isClosed = false;
  let pingSupported = false;
  let needsVerification = false;
  let lastActivityAt = Date.now();
  let verifying: Promise<boolean> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const settleAll = (): void => {
    isClosed = true;
    stopHeartbeat();
    for (const call of pending.values()) {
      call.reject(new SessionTransportError(false));
    }
    pending.clear();
  };

  const reader = createLineReader({
    maxBytes: () => EXTERNAL_CONTROL_MESSAGE_MAX_BYTES,
    onLine: (line) => {
      lastActivityAt = Date.now();
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

  function sendEnvelope(
    id: string,
    message: unknown,
    timeoutMs: number,
    isPing = false
  ): Promise<ExternalControlResult> {
    if (isClosed || socket.destroyed || !socket.writable) {
      return Promise.reject(new SessionTransportError(true));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        if (isPing) {
          socket.destroy();
        } else {
          needsVerification = true;
          if (!pingSupported || pending.size === 0) {
            socket.destroy();
          } else {
            void verifyAlive(0);
          }
        }
        reject(new SessionTimeoutError());
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
      try {
        const encoded = encodeLine(message);
        socket.write(encoded, (writeError) => {
          if (!writeError) return;
          const call = pending.get(id);
          if (!call) return;
          pending.delete(id);
          socket.destroy();
          call.reject(new SessionTransportError(true));
        });
        lastActivityAt = Date.now();
      } catch {
        pending.delete(id);
        socket.destroy();
        reject(new SessionTransportError(true));
      }
    });
  }

  function verifyAlive(maxIdleMs: number): Promise<boolean> {
    if (isClosed || socket.destroyed) return Promise.resolve(false);
    if (!pingSupported) return Promise.resolve(!isClosed && !socket.destroyed);
    if (!needsVerification && Date.now() - lastActivityAt < maxIdleMs) {
      return Promise.resolve(true);
    }
    if (verifying) return verifying;
    const pingId = randomUUID();
    const timeout = Math.min(PING_TIMEOUT_MS, options.heartbeatTimeoutMs);
    verifying = sendEnvelope(
      pingId,
      createEnvelope("externalControl.ping", {}, { id: pingId }),
      timeout,
      true
    )
      .then((result) => {
        if (result.status === "accepted") {
          needsVerification = false;
          return true;
        }
        socket.destroy();
        return false;
      })
      .catch(() => {
        socket.destroy();
        return false;
      })
      .finally(() => {
        verifying = undefined;
      });
    return verifying;
  }

  return {
    request(id, message, customTimeoutMs) {
      return sendEnvelope(
        id,
        message,
        customTimeoutMs ?? options.timeoutMs,
        false
      );
    },
    enableHeartbeat() {
      pingSupported = true;
      if (heartbeatTimer || isClosed || options.heartbeatIntervalMs <= 0)
        return;
      const checkInterval = Math.max(
        10,
        Math.floor(options.heartbeatIntervalMs / 2)
      );
      heartbeatTimer = setInterval(() => {
        if (isClosed || socket.destroyed) {
          stopHeartbeat();
          return;
        }
        if (pending.size > 0 || verifying) return;
        if (Date.now() - lastActivityAt < options.heartbeatIntervalMs) return;
        void verifyAlive(0);
      }, checkInterval);
      heartbeatTimer.unref();
    },
    verifyAlive,
    close: () => {
      stopHeartbeat();
      socket.destroy();
    },
    closed: () => isClosed
  };
}

function throwRejection(
  result: Extract<ExternalControlResult, { status: "rejected" }>
): never {
  throw new ExternalControlError(result.error.code, result.error.message);
}

function isFreshMarker(startedAt: string, maxAgeMs: number, now: () => number) {
  return now() - Date.parse(startedAt) < maxAgeMs;
}

export function createBridgeConnection(options: BridgeConnectionOptions) {
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const launchWaitMs = options.launchWaitMs ?? LAUNCH_WAIT_MS;
  const launchPollMs = options.launchPollMs ?? LAUNCH_POLL_MS;
  const callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const idleCheckMs = options.idleCheckMs ?? IDLE_CHECK_MS;
  const restartWaitMs = options.restartWaitMs ?? RESTART_HOLD_MS;
  const restartExitWaitMs =
    options.restartExitWaitMs ?? Math.min(RESTART_EXIT_WAIT_MS, restartWaitMs);
  const relaunchGraceMs = options.relaunchGraceMs ?? RELAUNCH_GRACE_MS;
  const readyWaitMs = options.readyWaitMs ?? READY_WAIT_MS;
  const now = options.now ?? Date.now;
  const terminateProcess =
    options.terminateProcess ??
    ((pid: number) => defaultTerminateProcess(pid, isAlive, launchPollMs));

  let session: Session | undefined;
  let opening: Promise<Session> | undefined;
  let restarting: Promise<void> | undefined;

  function launchWithCheck(): AppLaunch {
    try {
      return options.launch();
    } catch (error: unknown) {
      throw appUnavailable(error instanceof Error ? error.message : undefined);
    }
  }

  /** Undefined means the state is stale and the app must be started. */
  async function tryState(
    state: ExternalControlStateFile | undefined,
    allowTokenRetry = true
  ): Promise<{ session: Session; state: ReadyState } | undefined> {
    if (!state || !isAlive(state.pid)) return undefined;
    if (state.status === "disabled") throw disabled();
    if (state.status === "updating" || state.status === "restarting") {
      return undefined;
    }
    let socket: Socket;
    try {
      socket = await openSocket(state.endpoint);
    } catch {
      return undefined;
    }
    const candidate = createSession(socket, {
      timeoutMs: callTimeoutMs,
      heartbeatIntervalMs,
      heartbeatTimeoutMs
    });
    const id = randomUUID();
    let welcome: ExternalControlResult;
    try {
      welcome = await candidate.request(
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
    } catch (error: unknown) {
      candidate.close();
      if (
        error instanceof SessionTransportError ||
        error instanceof SessionTimeoutError
      ) {
        return undefined;
      }
      throw error;
    }
    if (welcome.status === "rejected") {
      candidate.close();
      if (allowTokenRetry && welcome.error.code === "external.unauthorized") {
        const latest = await options.readState();
        if (
          latest?.status === "ready" &&
          isAlive(latest.pid) &&
          (latest.token !== state.token || latest.pid !== state.pid)
        ) {
          return tryState(latest, false);
        }
      }
      throwRejection(welcome);
    }
    if (isRecord(welcome.payload) && welcome.payload.ping === true) {
      candidate.enableHeartbeat();
    }
    return { session: candidate, state };
  }

  async function waitForRestartCompletion(input: {
    previousPid: number;
    previousStartedAt?: string;
    previousToken?: string;
    sawRestarting?: boolean;
    force?: boolean;
    launched?: boolean;
    launch?: AppLaunch;
  }): Promise<{ session: Session; state: ReadyState; launched: boolean }> {
    const startedWaitAt = Date.now();
    const deadline = startedWaitAt + restartWaitMs;
    const exitDeadline = startedWaitAt + restartExitWaitMs;
    let sawRestarting = input.sawRestarting === true;
    let exitedAt = isAlive(input.previousPid) ? undefined : startedWaitAt;
    let launched = input.launched === true;
    let launch = input.launch;
    let forceTerminated = false;

    while (Date.now() < deadline) {
      if (launch) {
        const failure = launch.failure?.();
        if (failure) throw appUnavailable(failure);
      }
      const next = await options.readState();
      if (
        next?.status === "updating" &&
        isFreshMarker(next.startedAt, UPDATE_HOLD_MS, now)
      ) {
        throw new AppUpdatingError();
      }
      if (next?.status === "disabled" && isAlive(next.pid)) {
        throw disabled();
      }
      if (next?.status === "restarting") {
        sawRestarting = true;
      }
      if (exitedAt === undefined && !isAlive(input.previousPid)) {
        exitedAt = Date.now();
      }
      if (next?.status === "ready") {
        const isDistinctInstance =
          sawRestarting ||
          exitedAt !== undefined ||
          next.pid !== input.previousPid ||
          (input.previousStartedAt !== undefined &&
            next.startedAt !== input.previousStartedAt) ||
          (input.previousToken !== undefined &&
            next.token !== input.previousToken);
        if (isDistinctInstance) {
          const connected = await tryState(next);
          if (connected) {
            return { ...connected, launched };
          }
        }
      }
      const hasNewLiveProcess =
        next !== undefined &&
        next.pid !== input.previousPid &&
        isAlive(next.pid);
      if (
        input.force &&
        !forceTerminated &&
        exitedAt === undefined &&
        Date.now() >= exitDeadline &&
        !hasNewLiveProcess
      ) {
        forceTerminated = true;
        await terminateProcess(input.previousPid);
        exitedAt = Date.now();
        if (!launched) {
          launched = true;
          launch = launchWithCheck();
        }
      } else if (
        exitedAt !== undefined &&
        !launched &&
        !hasNewLiveProcess &&
        Date.now() - exitedAt >= relaunchGraceMs
      ) {
        launched = true;
        launch = launchWithCheck();
      }
      await delay(launchPollMs);
    }
    throw appUnavailable("重启超时");
  }

  async function open(): Promise<Session> {
    const state = await options.readState();
    if (
      state?.status === "updating" &&
      isFreshMarker(state.startedAt, UPDATE_HOLD_MS, now)
    ) {
      throw new AppUpdatingError();
    }
    if (
      state?.status === "restarting" &&
      isFreshMarker(state.startedAt, RESTART_HOLD_MS, now)
    ) {
      const restarted = await waitForRestartCompletion({
        previousPid: state.pid,
        previousStartedAt: state.startedAt,
        sawRestarting: true
      });
      return restarted.session;
    }
    const existing = await tryState(state);
    if (existing) return existing.session;

    const launch = launchWithCheck();
    const deadline = Date.now() + launchWaitMs;
    while (Date.now() < deadline) {
      await delay(launchPollMs);
      const failure = launch?.failure?.();
      if (failure) throw appUnavailable(failure);
      const next = await options.readState();
      if (
        next?.status === "updating" &&
        isFreshMarker(next.startedAt, UPDATE_HOLD_MS, now)
      ) {
        throw new AppUpdatingError();
      }
      const started = await tryState(next);
      if (started) return started.session;
    }
    throw appUnavailable("启动超时");
  }

  async function ensureSession(): Promise<Session> {
    if (restarting) {
      await restarting.catch(() => undefined);
    }
    const current = session;
    if (current && !current.closed()) {
      const alive = await current.verifyAlive(idleCheckMs);
      if (alive && !current.closed()) return current;
      if (session === current) {
        current.close();
        session = undefined;
      }
    }
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

  async function waitForRendererReady(
    active: Session
  ): Promise<Partial<GetAppStatusResult>> {
    const deadline = Date.now() + readyWaitMs;
    let lastStatus: Partial<GetAppStatusResult> = {};
    while (true) {
      const id = randomUUID();
      try {
        const result = await active.request(
          id,
          createEnvelope(
            "externalControl.call",
            { tool: "get_app_status", arguments: {} },
            { id }
          )
        );
        if (result.status !== "accepted") return lastStatus;
        const parsed = GetAppStatusResultSchema.safeParse(result.payload);
        if (!parsed.success) return lastStatus;
        lastStatus = parsed.data;
        if (parsed.data.rendererReady || Date.now() >= deadline) {
          return lastStatus;
        }
      } catch {
        return lastStatus;
      }
      await delay(Math.min(READY_POLL_MS, Math.max(10, deadline - Date.now())));
    }
  }

  function buildRestartResult(input: {
    restarted: boolean;
    restarting?: boolean;
    launched?: boolean;
    forced: boolean;
    previousPid?: number;
    pid?: number;
    status?: Partial<GetAppStatusResult>;
  }): ExternalRestartAppResult {
    return ExternalRestartAppResultSchema.parse({
      restarted: input.restarted,
      ...(input.restarting !== undefined
        ? { restarting: input.restarting }
        : {}),
      ...(input.launched ? { launched: true } : {}),
      forced: input.forced,
      ...(input.previousPid !== undefined
        ? { previousPid: input.previousPid }
        : {}),
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      ...(input.status?.appVersion !== undefined
        ? { appVersion: input.status.appVersion }
        : {}),
      ...(input.status?.rendererReady !== undefined
        ? { rendererReady: input.status.rendererReady }
        : {}),
      ...(input.status?.activeRunCount !== undefined
        ? { activeRunCount: input.status.activeRunCount }
        : {}),
      ...(input.status?.permissionMode !== undefined
        ? { permissionMode: input.status.permissionMode }
        : {})
    });
  }

  async function restartAppFlow(
    rawArgs: Record<string, unknown>
  ): Promise<ExternalRestartAppResult> {
    if (restarting) {
      throw new ExternalControlError(
        "external.busy",
        "DeepWrite 正在重启中，请等待当前重启完成后再试。"
      );
    }
    const parsed = ExternalRestartAppInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".");
      throw new ExternalControlError(
        "external.invalid_input",
        `restart_app 的参数不正确${field ? `（${field}）` : ""}：${issue?.message ?? "格式无效"}`
      );
    }
    const force = parsed.data.force === true;
    const waitForReady = parsed.data.waitForReady !== false;

    let releaseRestart!: () => void;
    restarting = new Promise<void>((resolve) => {
      releaseRestart = resolve;
    });

    try {
      const initialState = await options.readState();
      if (
        initialState?.status === "updating" &&
        isFreshMarker(initialState.startedAt, UPDATE_HOLD_MS, now)
      ) {
        throw new AppUpdatingError();
      }
      if (initialState?.status === "disabled" && isAlive(initialState.pid)) {
        throw disabled();
      }
      if (
        initialState?.status === "restarting" &&
        isFreshMarker(initialState.startedAt, RESTART_HOLD_MS, now)
      ) {
        if (!waitForReady) {
          return buildRestartResult({
            restarted: false,
            restarting: true,
            forced: force,
            previousPid: initialState.pid
          });
        }
        const completed = await waitForRestartCompletion({
          previousPid: initialState.pid,
          previousStartedAt: initialState.startedAt,
          sawRestarting: true,
          force
        });
        session?.close();
        session = completed.session;
        const status = await waitForRendererReady(completed.session);
        return buildRestartResult({
          restarted: true,
          launched: completed.launched,
          forced: force,
          previousPid: initialState.pid,
          pid: completed.state.pid,
          status
        });
      }

      if (
        !initialState ||
        initialState.status !== "ready" ||
        !isAlive(initialState.pid)
      ) {
        if (!waitForReady) {
          launchWithCheck();
          return buildRestartResult({
            restarted: true,
            launched: true,
            forced: force
          });
        }
        const created = await open();
        session = created;
        const latestState = await options.readState();
        const status = await waitForRendererReady(created);
        return buildRestartResult({
          restarted: true,
          launched: true,
          forced: force,
          ...(latestState && latestState.status === "ready"
            ? { pid: latestState.pid }
            : {}),
          status
        });
      }

      const previousPid = initialState.pid;
      const previousStartedAt = initialState.startedAt;
      const previousToken = initialState.token;

      let active = session && !session.closed() ? session : undefined;
      if (active && !(await active.verifyAlive(0))) {
        active.close();
        session = undefined;
        active = undefined;
      }
      if (!active) {
        const connected = await tryState(initialState);
        if (connected) {
          active = connected.session;
          session = active;
        }
      }

      if (active) {
        const id = randomUUID();
        let response: ExternalControlResult | undefined;
        let transportOrTimeoutError: unknown;
        try {
          response = await active.request(
            id,
            createEnvelope(
              "externalControl.call",
              { tool: "restart_app", arguments: { force, waitForReady } },
              { id }
            )
          );
        } catch (error: unknown) {
          if (
            error instanceof SessionTransportError ||
            error instanceof SessionTimeoutError
          ) {
            transportOrTimeoutError = error;
          } else {
            throw error;
          }
        }

        if (response) {
          if (response.status === "rejected") {
            throwRejection(response);
          }
          active.close();
          if (session === active) session = undefined;
          const serverPayload = ExternalRestartAppResultSchema.parse(
            response.payload
          );
          if (!waitForReady) {
            return serverPayload;
          }
          const completed = await waitForRestartCompletion({
            previousPid: serverPayload.previousPid ?? previousPid,
            previousStartedAt,
            previousToken,
            force
          });
          session = completed.session;
          const status = await waitForRendererReady(completed.session);
          return buildRestartResult({
            restarted: true,
            launched: completed.launched,
            forced: force,
            previousPid: serverPayload.previousPid ?? previousPid,
            pid: completed.state.pid,
            status
          });
        }

        if (transportOrTimeoutError) {
          active.close();
          if (session === active) session = undefined;
        }
      }

      // Connection failed or timed out while the process looked alive: inspect state.
      const current = await options.readState();
      if (
        current?.status === "updating" &&
        isFreshMarker(current.startedAt, UPDATE_HOLD_MS, now)
      ) {
        throw new AppUpdatingError();
      }
      const alreadyRestartingOrNew =
        current?.status === "restarting" ||
        (current?.status === "ready" &&
          (current.pid !== previousPid ||
            current.startedAt !== previousStartedAt ||
            current.token !== previousToken)) ||
        !isAlive(previousPid);

      if (alreadyRestartingOrNew) {
        if (!waitForReady) {
          return buildRestartResult({
            restarted: true,
            restarting: current?.status === "restarting",
            forced: force,
            previousPid
          });
        }
        const completed = await waitForRestartCompletion({
          previousPid,
          previousStartedAt,
          previousToken,
          sawRestarting: current?.status === "restarting",
          force
        });
        session = completed.session;
        const status = await waitForRendererReady(completed.session);
        return buildRestartResult({
          restarted: true,
          launched: completed.launched,
          forced: force,
          previousPid,
          pid: completed.state.pid,
          status
        });
      }

      if (!force) {
        throw new ExternalControlError(
          "external.not_ready",
          "DeepWrite 当前无响应，未能安全完成重启。请先检查软件状态，或传 force: true 强制重启。"
        );
      }

      session?.close();
      session = undefined;
      await terminateProcess(previousPid);
      const forcedLaunch = launchWithCheck();
      if (!waitForReady) {
        return buildRestartResult({
          restarted: true,
          launched: true,
          forced: true,
          previousPid
        });
      }
      const completed = await waitForRestartCompletion({
        previousPid,
        previousStartedAt,
        previousToken,
        force: true,
        launched: true,
        launch: forcedLaunch
      });
      session = completed.session;
      const status = await waitForRendererReady(completed.session);
      return buildRestartResult({
        restarted: true,
        launched: true,
        forced: true,
        previousPid,
        pid: completed.state.pid,
        status
      });
    } finally {
      restarting = undefined;
      releaseRestart();
    }
  }

  async function invokeOnce(
    tool: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const active = await ensureSession();
    const id = randomUUID();
    const result = await active.request(
      id,
      createEnvelope("externalControl.call", { tool, arguments: args }, { id })
    );
    if (result.status === "rejected") throwRejection(result);
    return result.payload;
  }

  return {
    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
      if (tool === "restart_app") {
        return restartAppFlow(args);
      }
      try {
        return await invokeOnce(tool, args);
      } catch (error: unknown) {
        if (!(error instanceof SessionTransportError)) throw error;
        session?.close();
        session = undefined;
        const annotations = findExternalControlTool(tool)?.annotations;
        const canRetry =
          error.beforeWrite ||
          Boolean(annotations?.readOnlyHint || annotations?.idempotentHint);
        if (!canRetry) throw error;
        return await invokeOnce(tool, args);
      }
    },
    close(): void {
      session?.close();
      session = undefined;
    }
  };
}
