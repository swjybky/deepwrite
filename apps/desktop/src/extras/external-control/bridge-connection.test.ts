import type { ExternalControlStateFile } from "@deepwrite/contracts/external-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridgeConnection } from "./bridge-connection";
import type { AppLaunch } from "./bridge-launch";
import type { ExternalControlPaths } from "./control-paths";
import { readExternalControlState } from "./control-state-file";
import { createExternalControl, type ExternalControl } from "./index";
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
    launchWaitMs?: number;
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
      ...(overrides.isProcessAlive
        ? { isProcessAlive: overrides.isProcessAlive }
        : {})
    });

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
});
