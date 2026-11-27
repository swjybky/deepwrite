import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  type ExternalControlStateFile
} from "@deepwrite/contracts/external-control";
import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdatingError, createBridgeConnection } from "./bridge-connection";
import type { AppLaunch } from "./bridge-launch";
import type { ExternalControlPaths } from "./control-paths";
import { readExternalControlState } from "./control-state-file";
import { createExternalControl, type ExternalControl } from "./index";
import { createLineReader, encodeLine } from "./line-framing";
import {
  TEST_TOKEN,
  createTestPaths,
  testAppState,
  testControlOptions
} from "./external-control.test-support";

const ALIVE = process.pid;
const DEAD = 999_999;

describe("bridge connection", () => {
  let paths: ExternalControlPaths;
  let cleanup: () => Promise<void>;
  let control: ExternalControl;

  const connection = (overrides: {
    launch?: () => AppLaunch;
    readState?: () => Promise<ExternalControlStateFile | undefined>;
    isProcessAlive?: (pid: number) => boolean;
    terminateProcess?: (pid: number) => Promise<void>;
    launchWaitMs?: number;
    callTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    idleCheckMs?: number;
    restartWaitMs?: number;
    restartExitWaitMs?: number;
    relaunchGraceMs?: number;
    readyWaitMs?: number;
    now?: () => number;
  }) =>
    createBridgeConnection({
      readState:
        overrides.readState ??
        (() => readExternalControlState(paths.stateFile)),
      launch:
        overrides.launch ??
        (() => {
          throw new Error("launch was not expected");
        }),
      client: () => ({ name: "test-client" }),
      launchPollMs: 5,
      launchWaitMs: overrides.launchWaitMs ?? 2_000,
      ...(overrides.callTimeoutMs !== undefined
        ? { callTimeoutMs: overrides.callTimeoutMs }
        : {}),
      ...(overrides.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: overrides.heartbeatIntervalMs }
        : {}),
      ...(overrides.heartbeatTimeoutMs !== undefined
        ? { heartbeatTimeoutMs: overrides.heartbeatTimeoutMs }
        : {}),
      ...(overrides.idleCheckMs !== undefined
        ? { idleCheckMs: overrides.idleCheckMs }
        : {}),
      ...(overrides.restartWaitMs !== undefined
        ? { restartWaitMs: overrides.restartWaitMs }
        : {}),
      ...(overrides.restartExitWaitMs !== undefined
        ? { restartExitWaitMs: overrides.restartExitWaitMs }
        : {}),
      ...(overrides.relaunchGraceMs !== undefined
        ? { relaunchGraceMs: overrides.relaunchGraceMs }
        : {}),
      ...(overrides.readyWaitMs !== undefined
        ? { readyWaitMs: overrides.readyWaitMs }
        : {}),
      ...(overrides.isProcessAlive
        ? { isProcessAlive: overrides.isProcessAlive }
        : {}),
      ...(overrides.terminateProcess
        ? { terminateProcess: overrides.terminateProcess }
        : {}),
      ...(overrides.now ? { now: overrides.now } : {})
    });

  async function startRawMockServer(
    endpoint: string,
    onMessage: (
      envelope: { id: string; type: string; payload?: Record<string, unknown> },
      socket: Socket
    ) => void
  ): Promise<{ close(): Promise<void> }> {
    await mkdir(dirname(endpoint), { recursive: true });
    if (process.platform !== "win32") await rm(endpoint, { force: true });
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      const reader = createLineReader({
        maxBytes: () => 1024 * 1024,
        onLine: (line) => {
          const parsed = JSON.parse(line) as {
            id: string;
            type: string;
            payload?: Record<string, unknown>;
          };
          onMessage(parsed, socket);
        },
        onOverflow: () => socket.destroy()
      });
      socket.on("data", (chunk: Buffer) => reader.push(chunk));
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(endpoint);
    });
    return {
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    };
  }

  beforeEach(async () => {
    ({ paths, cleanup } = await createTestPaths());
    control = createExternalControl({
      ...testControlOptions(paths),
      app: testAppState({ dataDirectory: () => paths.directory }),
      pid: ALIVE,
      createToken: () => TEST_TOKEN,
      warn: vi.fn()
    });
  });

  afterEach(async () => {
    await control.stop();
    await cleanup();
  });

  it("calls a running app without launching it", async () => {
    await control.sync(true);
    const launch = vi.fn<() => AppLaunch>();
    const bridge = connection({ launch });
    await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
      appVersion: "1.0.0"
    });
    expect(launch).not.toHaveBeenCalled();
    bridge.close();
  });

  it("reuses one connection for concurrent calls", async () => {
    await control.sync(true);
    const readState = vi.fn(() => readExternalControlState(paths.stateFile));
    const bridge = connection({ readState });
    await Promise.all([
      bridge.call("get_app_status", {}),
      bridge.call("get_app_status", {})
    ]);
    expect(readState).toHaveBeenCalledOnce();
    bridge.close();
  });

  it("launches the app and waits for its endpoint", async () => {
    const launch = vi.fn(() => {
      void control.sync(true);
      return { failure: () => undefined };
    });
    const bridge = connection({ launch });
    await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
      rendererReady: true
    });
    expect(launch).toHaveBeenCalledOnce();
    bridge.close();
  });

  it("returns a clear error when the switch is off", async () => {
    await control.noteLaunchRequest();
    await control.sync(false);
    const launch = vi.fn<() => AppLaunch>();
    await expect(
      connection({ launch }).call("get_app_status", {})
    ).rejects.toMatchObject({ code: "external.disabled" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("learns the switch is off after launching", async () => {
    const launch = vi.fn(() => {
      void control.noteLaunchRequest().then(() => control.sync(false));
      return { failure: () => undefined };
    });
    await expect(
      connection({ launch }).call("get_app_status", {})
    ).rejects.toMatchObject({ code: "external.disabled" });
  });

  it("ignores a disabled marker from a dead process", async () => {
    let reads = 0;
    const stale: ExternalControlStateFile = {
      status: "disabled",
      protocolVersion: 1,
      appVersion: "1.0.0",
      pid: DEAD
    };
    const bridge = connection({
      readState: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve(stale)
          : readExternalControlState(paths.stateFile);
      },
      isProcessAlive: (pid) => pid === ALIVE,
      launch: () => {
        void control.sync(true);
        return { failure: () => undefined };
      }
    });
    await expect(bridge.call("get_app_status", {})).resolves.toBeDefined();
    bridge.close();
  });

  it("does not reopen the app while an update installs", async () => {
    const updating: ExternalControlStateFile = {
      status: "updating",
      protocolVersion: 1,
      appVersion: "1.0.0",
      pid: DEAD,
      startedAt: "2026-11-14T00:00:00.000Z"
    };
    const launch = vi.fn<() => AppLaunch>();
    const call = connection({
      readState: () => Promise.resolve(updating),
      launch,
      now: () => Date.parse("2026-11-14T00:05:00.000Z")
    }).call("get_app_status", {});

    await expect(call).rejects.toBeInstanceOf(AppUpdatingError);
    await expect(call).rejects.toMatchObject({
      code: "external.app_unavailable"
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("reopens the app once an update marker has expired", async () => {
    let launched = false;
    const bridge = connection({
      readState: () =>
        launched
          ? readExternalControlState(paths.stateFile)
          : Promise.resolve({
              status: "updating",
              protocolVersion: 1,
              appVersion: "1.0.0",
              pid: DEAD,
              startedAt: "2026-11-14T00:00:00.000Z"
            }),
      launch: () => {
        launched = true;
        void control.sync(true);
        return { failure: () => undefined };
      },
      now: () => Date.parse("2026-11-14T00:11:00.000Z")
    });
    await expect(bridge.call("get_app_status", {})).resolves.toBeDefined();
    bridge.close();
  });

  it("launches again when the endpoint in the state is dead", async () => {
    const stale: ExternalControlStateFile = {
      status: "ready",
      protocolVersion: 1,
      appVersion: "1.0.0",
      pid: ALIVE,
      endpoint: paths.endpoint,
      token: TEST_TOKEN,
      startedAt: "2026-10-31T00:00:00.000Z"
    };
    let launched = false;
    const bridge = connection({
      readState: () =>
        launched
          ? readExternalControlState(paths.stateFile)
          : Promise.resolve(stale),
      launch: () => {
        launched = true;
        void control.sync(true);
        return { failure: () => undefined };
      }
    });
    await expect(bridge.call("get_app_status", {})).resolves.toBeDefined();
    bridge.close();
  });

  it("fails fast when the app cannot start", async () => {
    await expect(
      connection({
        launch: () => ({ failure: () => "SIGABRT" })
      }).call("get_app_status", {})
    ).rejects.toMatchObject({
      code: "external.app_unavailable",
      message: expect.stringContaining("SIGABRT") as string
    });
  });

  it("reports a launch that spawn itself refused", async () => {
    await expect(
      connection({
        launch: () => {
          throw new Error("spawn EPERM");
        }
      }).call("get_app_status", {})
    ).rejects.toMatchObject({ code: "external.app_unavailable" });
  });

  it("gives up when the endpoint never appears", async () => {
    await expect(
      connection({
        launchWaitMs: 30,
        launch: () => ({ failure: () => undefined })
      }).call("get_app_status", {})
    ).rejects.toMatchObject({ code: "external.app_unavailable" });
  });

  it("surfaces a stale token instead of retrying forever", async () => {
    await control.sync(true);
    const state = await readExternalControlState(paths.stateFile);
    const bridge = connection({
      readState: () =>
        Promise.resolve({
          ...state!,
          token: "c".repeat(64)
        } as ExternalControlStateFile)
    });
    await expect(bridge.call("get_app_status", {})).rejects.toMatchObject({
      code: "external.unauthorized"
    });
  });

  it("reconnects after the app restarts", async () => {
    await control.sync(true);
    const bridge = connection({});
    await bridge.call("get_app_status", {});
    await control.sync(false);
    await control.sync(true);
    await expect(bridge.call("get_app_status", {})).resolves.toBeDefined();
    bridge.close();
  });

  it("reports an unexpected app failure as not ready", async () => {
    await control.sync(true);
    const slow = createExternalControl({
      ...testControlOptions(paths),
      app: testAppState({
        dataDirectory: () => paths.directory,
        generalSettings: () => {
          throw new Error("unexpected");
        }
      }),
      pid: ALIVE,
      createToken: () => TEST_TOKEN,
      warn: vi.fn()
    });
    await control.stop();
    await slow.sync(true);
    const bridge = connection({});
    await expect(bridge.call("get_app_status", {})).rejects.toMatchObject({
      code: "external.not_ready"
    });
    bridge.close();
    await slow.stop();
  });

  it("evicts a hung connection via idle heartbeat and reconnects on next call", async () => {
    const hungEndpoint = join(paths.directory, "h.sock");
    let useHealthy = false;
    const mock = await startRawMockServer(hungEndpoint, (msg, socket) => {
      if (msg.type === "externalControl.hello") {
        socket.write(
          encodeLine({
            status: "accepted",
            requestId: msg.id,
            payload: {
              protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
              ping: true
            }
          })
        );
      } else if (msg.type === "externalControl.call") {
        socket.write(
          encodeLine({
            status: "accepted",
            requestId: msg.id,
            payload: { from: "hung-before-stall" }
          })
        );
      }
      // Deliberately ignore externalControl.ping to simulate a half-open / hung peer.
    });
    try {
      await control.sync(true);
      const healthyState = await readExternalControlState(paths.stateFile);
      const bridge = connection({
        heartbeatIntervalMs: 30,
        heartbeatTimeoutMs: 30,
        idleCheckMs: 5_000,
        readState: () =>
          Promise.resolve(
            useHealthy
              ? healthyState
              : ({
                  ...healthyState!,
                  endpoint: hungEndpoint
                } as ExternalControlStateFile)
          )
      });
      await expect(bridge.call("get_app_status", {})).resolves.toEqual({
        from: "hung-before-stall"
      });
      useHealthy = true;
      await new Promise((resolve) => setTimeout(resolve, 140));
      await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
        appVersion: "1.0.0"
      });
      bridge.close();
    } finally {
      await mock.close();
    }
  });

  it("verifies idle connections before sending writes and reconnects transparently", async () => {
    const staleEndpoint = join(paths.directory, "s.sock");
    let useHealthy = false;
    let writeCallsOnStale = 0;
    const mock = await startRawMockServer(staleEndpoint, (msg, socket) => {
      if (msg.type === "externalControl.hello") {
        socket.write(
          encodeLine({
            status: "accepted",
            requestId: msg.id,
            payload: {
              protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
              ping: true
            }
          })
        );
      } else if (msg.type === "externalControl.call") {
        if (msg.payload?.tool === "manage_work") writeCallsOnStale += 1;
        socket.write(
          encodeLine({
            status: "accepted",
            requestId: msg.id,
            payload: { ok: true }
          })
        );
      }
    });
    try {
      const healthy = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          command: (command) =>
            Promise.resolve({
              status: "accepted",
              requestId: command.id,
              payload: { id: "new-work" }
            })
        }),
        pid: ALIVE,
        createToken: () => TEST_TOKEN,
        warn: vi.fn()
      });
      await healthy.sync(true);
      const healthyState = await readExternalControlState(paths.stateFile);
      const bridge = connection({
        idleCheckMs: 25,
        heartbeatIntervalMs: 60_000,
        heartbeatTimeoutMs: 30,
        readState: () =>
          Promise.resolve(
            useHealthy
              ? healthyState
              : ({
                  ...healthyState!,
                  endpoint: staleEndpoint
                } as ExternalControlStateFile)
          )
      });
      await bridge.call("get_app_status", {});
      useHealthy = true;
      await new Promise((resolve) => setTimeout(resolve, 40));
      await expect(
        bridge.call("manage_work", {
          action: "create",
          type: "short",
          genre: "其他",
          title: "新书"
        })
      ).resolves.toEqual({ id: "new-work", title: "新书" });
      expect(writeCallsOnStale).toBe(0);
      bridge.close();
      await healthy.stop();
    } finally {
      await mock.close();
    }
  });

  it("retries read-only calls after mid-call disconnect but does not replay sent writes", async () => {
    const flakyEndpoint = join(paths.directory, "f.sock");
    let useHealthy = false;
    let writeAttempts = 0;
    const mock = await startRawMockServer(flakyEndpoint, (msg, socket) => {
      if (msg.type === "externalControl.hello") {
        socket.write(
          encodeLine({
            status: "accepted",
            requestId: msg.id,
            payload: {
              protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
              ping: true
            }
          })
        );
      } else if (msg.type === "externalControl.call") {
        if (msg.payload?.tool === "write_document") writeAttempts += 1;
        useHealthy = true;
        socket.destroy();
      }
    });
    try {
      await control.sync(true);
      const healthyState = await readExternalControlState(paths.stateFile);
      const bridge = connection({
        idleCheckMs: 60_000,
        heartbeatIntervalMs: 60_000,
        readState: () =>
          Promise.resolve(
            useHealthy
              ? healthyState
              : ({
                  ...healthyState!,
                  endpoint: flakyEndpoint
                } as ExternalControlStateFile)
          )
      });

      await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
        appVersion: "1.0.0"
      });

      useHealthy = false;
      bridge.close();
      await expect(
        bridge.call("write_document", {
          workId: "w1",
          documentId: "d1",
          content: "x",
          baseRevision: "r1"
        })
      ).rejects.toMatchObject({ code: "external.app_unavailable" });
      expect(writeAttempts).toBe(1);

      await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
        appVersion: "1.0.0"
      });
      bridge.close();
    } finally {
      await mock.close();
    }
  });

  it("falls back to launching when handshake drops mid-flight", async () => {
    const droppingEndpoint = join(paths.directory, "d.sock");
    let launched = false;
    const mock = await startRawMockServer(droppingEndpoint, (_msg, socket) => {
      socket.destroy();
    });
    try {
      await control.sync(true);
      const healthyState = await readExternalControlState(paths.stateFile);
      const launch = vi.fn(() => {
        launched = true;
        return { failure: () => undefined };
      });
      const bridge = connection({
        readState: () =>
          Promise.resolve(
            launched
              ? healthyState
              : ({
                  ...healthyState!,
                  endpoint: droppingEndpoint
                } as ExternalControlStateFile)
          ),
        launch
      });
      await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
        appVersion: "1.0.0"
      });
      expect(launch).toHaveBeenCalledOnce();
      bridge.close();
    } finally {
      await mock.close();
    }
  });

  it("retries once on token rotation race during hello", async () => {
    await control.sync(true);
    const live = await readExternalControlState(paths.stateFile);
    let reads = 0;
    const bridge = connection({
      readState: () => {
        reads += 1;
        return Promise.resolve(
          reads === 1
            ? ({ ...live!, token: "c".repeat(64) } as ExternalControlStateFile)
            : live
        );
      }
    });
    await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
      appVersion: "1.0.0"
    });
    expect(reads).toBe(2);
    bridge.close();
  });

  it("waits for restarting state instead of launching a duplicate app", async () => {
    await control.sync(true);
    const ready = await readExternalControlState(paths.stateFile);
    let reads = 0;
    const launch = vi.fn<() => AppLaunch>();
    const bridge = connection({
      readState: () => {
        reads += 1;
        if (reads <= 2) {
          return Promise.resolve({
            status: "restarting",
            protocolVersion: 1,
            appVersion: "1.0.0",
            pid: ALIVE,
            startedAt: new Date().toISOString()
          });
        }
        return Promise.resolve(ready);
      },
      launch
    });
    await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
      appVersion: "1.0.0"
    });
    expect(launch).not.toHaveBeenCalled();
    bridge.close();
  });

  describe("restart_app orchestration", () => {
    it("gracefully restarts, waits for exit and new ready instance, and reconnects", async () => {
      let currentPid = 10_001;
      let alivePids = new Set([10_001]);
      let rendererReady = false;
      const oldControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          requestRestart: ({ force }) => {
            setTimeout(async () => {
              await oldControl.stop({ restarting: true });
              alivePids = new Set([10_002]);
              currentPid = 10_002;
              await newControl.sync(true);
              setTimeout(() => {
                rendererReady = true;
              }, 20);
            }, 10);
            return {
              restarted: false,
              restarting: true,
              forced: force,
              previousPid: 10_001
            };
          }
        }),
        pid: 10_001,
        createToken: () => TEST_TOKEN,
        warn: vi.fn()
      });
      const newControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          rendererReady: () => rendererReady
        }),
        pid: 10_002,
        createToken: () => "b".repeat(64),
        warn: vi.fn()
      });
      await oldControl.sync(true);
      const launch = vi.fn<() => AppLaunch>();
      const bridge = connection({
        isProcessAlive: (pid) => alivePids.has(pid),
        launch,
        relaunchGraceMs: 2_000,
        restartWaitMs: 4_000
      });
      try {
        const result = await bridge.call("restart_app", {});
        expect(result).toMatchObject({
          restarted: true,
          forced: false,
          previousPid: 10_001,
          pid: 10_002,
          rendererReady: true
        });
        expect(launch).not.toHaveBeenCalled();
        await expect(bridge.call("get_app_status", {})).resolves.toMatchObject({
          rendererReady: true
        });
        expect(currentPid).toBe(10_002);
      } finally {
        bridge.close();
        await oldControl.stop();
        await newControl.stop();
      }
    });

    it("falls back to launching if relaunch does not spawn within relaunchGraceMs", async () => {
      let alivePids = new Set([20_001]);
      const oldControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          requestRestart: ({ force }) => {
            setTimeout(async () => {
              await oldControl.stop({ restarting: true });
              alivePids = new Set();
            }, 10);
            return {
              restarted: false,
              restarting: true,
              forced: force,
              previousPid: 20_001
            };
          }
        }),
        pid: 20_001,
        createToken: () => TEST_TOKEN,
        warn: vi.fn()
      });
      const newControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({ dataDirectory: () => paths.directory }),
        pid: 20_002,
        createToken: () => "b".repeat(64),
        warn: vi.fn()
      });
      await oldControl.sync(true);
      const launch = vi.fn(() => {
        alivePids.add(20_002);
        void newControl.sync(true);
        return { failure: () => undefined };
      });
      const bridge = connection({
        isProcessAlive: (pid) => alivePids.has(pid),
        launch,
        relaunchGraceMs: 20,
        restartWaitMs: 3_000
      });
      try {
        await expect(bridge.call("restart_app", {})).resolves.toMatchObject({
          restarted: true,
          launched: true,
          previousPid: 20_001,
          pid: 20_002
        });
        expect(launch).toHaveBeenCalledOnce();
      } finally {
        bridge.close();
        await oldControl.stop();
        await newControl.stop();
      }
    });

    it("propagates server busy rejection without terminating or relaunching", async () => {
      const busyControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          activeRunCount: () => 1,
          requestRestart: () => ({ restarted: false })
        }),
        pid: ALIVE,
        createToken: () => TEST_TOKEN,
        warn: vi.fn()
      });
      await busyControl.sync(true);
      const terminateProcess = vi.fn(async () => undefined);
      const launch = vi.fn<() => AppLaunch>();
      const bridge = connection({ terminateProcess, launch });
      try {
        await expect(bridge.call("restart_app", {})).rejects.toMatchObject({
          code: "external.busy"
        });
        expect(terminateProcess).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
      } finally {
        bridge.close();
        await busyControl.stop();
      }
    });

    it("launches the app when restart_app is called while closed", async () => {
      const launch = vi.fn(() => {
        void control.sync(true);
        return { failure: () => undefined };
      });
      const bridge = connection({ launch });
      await expect(bridge.call("restart_app", {})).resolves.toMatchObject({
        restarted: true,
        launched: true,
        pid: ALIVE,
        rendererReady: true
      });
      expect(launch).toHaveBeenCalledOnce();
      bridge.close();
    });

    it("refuses restart_app while an update is installing", async () => {
      const bridge = connection({
        readState: () =>
          Promise.resolve({
            status: "updating",
            protocolVersion: 1,
            appVersion: "1.0.0",
            pid: DEAD,
            startedAt: "2026-11-14T00:00:00.000Z"
          }),
        now: () => Date.parse("2026-11-14T00:05:00.000Z")
      });
      await expect(bridge.call("restart_app", {})).rejects.toBeInstanceOf(
        AppUpdatingError
      );
    });

    it("refuses unresponsive app unless force is true, then terminates and relaunches", async () => {
      const hungEndpoint = join(paths.directory, "hr.sock");
      const alivePids = new Set([30_001]);
      let launched = false;
      const mock = await startRawMockServer(hungEndpoint, (msg, socket) => {
        if (msg.type === "externalControl.hello") {
          socket.write(
            encodeLine({
              status: "accepted",
              requestId: msg.id,
              payload: {
                protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
                ping: true
              }
            })
          );
        }
        // Ignore restart_app calls to simulate a frozen main process.
      });
      const newControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({ dataDirectory: () => paths.directory }),
        pid: 30_002,
        createToken: () => "b".repeat(64),
        warn: vi.fn()
      });
      const terminateProcess = vi.fn(async (pid: number) => {
        alivePids.delete(pid);
      });
      const launch = vi.fn(() => {
        launched = true;
        alivePids.add(30_002);
        void newControl.sync(true);
        return { failure: () => undefined };
      });
      const bridge = connection({
        callTimeoutMs: 40,
        heartbeatTimeoutMs: 30,
        isProcessAlive: (pid) => alivePids.has(pid),
        terminateProcess,
        launch,
        readState: () =>
          launched
            ? readExternalControlState(paths.stateFile)
            : Promise.resolve({
                status: "ready",
                protocolVersion: 1,
                appVersion: "1.0.0",
                pid: 30_001,
                endpoint: hungEndpoint,
                token: TEST_TOKEN,
                startedAt: "2026-11-14T00:00:00.000Z"
              })
      });
      try {
        await expect(bridge.call("restart_app", {})).rejects.toMatchObject({
          code: "external.not_ready"
        });
        expect(terminateProcess).not.toHaveBeenCalled();

        await expect(
          bridge.call("restart_app", { force: true })
        ).resolves.toMatchObject({
          restarted: true,
          launched: true,
          forced: true,
          previousPid: 30_001,
          pid: 30_002
        });
        expect(terminateProcess).toHaveBeenCalledWith(30_001);
        expect(launch).toHaveBeenCalledOnce();
      } finally {
        bridge.close();
        await mock.close();
        await newControl.stop();
      }
    });

    it("returns immediately when waitForReady is false", async () => {
      const quickControl = createExternalControl({
        ...testControlOptions(paths),
        app: testAppState({
          dataDirectory: () => paths.directory,
          requestRestart: ({ force }) => ({
            restarted: false,
            restarting: true,
            forced: force,
            previousPid: ALIVE
          })
        }),
        pid: ALIVE,
        createToken: () => TEST_TOKEN,
        warn: vi.fn()
      });
      await quickControl.sync(true);
      const bridge = connection({});
      try {
        await expect(
          bridge.call("restart_app", { waitForReady: false })
        ).resolves.toEqual({
          restarted: false,
          restarting: true,
          forced: false,
          previousPid: ALIVE
        });
      } finally {
        bridge.close();
        await quickControl.stop();
      }
    });
  });
});
