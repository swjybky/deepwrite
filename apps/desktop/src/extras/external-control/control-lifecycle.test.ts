import { createEnvelope } from "@deepwrite/contracts";
import { stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalControl, type ExternalControl } from "./index";
import type { ExternalControlPaths } from "./control-paths";
import {
  readExternalControlState,
  writeExternalControlState
} from "./control-state-file";
import {
  TEST_TOKEN,
  callEnvelope,
  connectRawClient,
  createTestPaths,
  helloEnvelope,
  testAppState,
  testControlOptions
} from "./external-control.test-support";

const onUnix = process.platform !== "win32";

describe("external control lifecycle", () => {
  let paths: ExternalControlPaths;
  let cleanup: () => Promise<void>;
  let control: ExternalControl;
  let token: string;

  beforeEach(async () => {
    ({ paths, cleanup } = await createTestPaths());
    token = TEST_TOKEN;
    control = createExternalControl({
      ...testControlOptions(paths),
      app: testAppState({ dataDirectory: () => paths.directory }),
      pid: 4242,
      createToken: () => token,
      warn: vi.fn()
    });
  });

  afterEach(async () => {
    await control.stop();
    await cleanup();
  });

  it("writes nothing while the switch stays off", async () => {
    await control.sync(false);
    await expect(stat(paths.directory)).rejects.toThrow();
  });

  it("publishes a working endpoint when switched on", async () => {
    await control.sync(true);
    const state = await readExternalControlState(paths.stateFile);
    expect(state).toMatchObject({
      status: "ready",
      pid: 4242,
      endpoint: paths.endpoint,
      token: TEST_TOKEN
    });

    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    await client.nextMessage();
    client.send(callEnvelope("call-1", "get_app_status"));
    expect(await client.nextMessage()).toMatchObject({
      status: "accepted",
      payload: { appVersion: "1.0.0", crossStageAutoApprove: true }
    });
    client.socket.destroy();
  });

  it("disconnects revoked clients and requires approval on reconnect", async () => {
    const confirmClient = vi.fn(async () => true);
    await control.stop();
    control = createExternalControl({
      ...testControlOptions(paths),
      app: testAppState({ dataDirectory: () => paths.directory }),
      createToken: () => TEST_TOKEN,
      confirmClient
    });
    await control.sync(true);
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    expect(await client.nextMessage()).toMatchObject({ status: "accepted" });
    const result = await control.handleSettingsCommand(
      createEnvelope(
        "externalControl.revokeClient",
        { name: "test-client" },
        { id: "revoke" }
      ) as never
    );
    expect(result).toMatchObject({ status: "accepted" });
    await client.closed();
    confirmClient.mockResolvedValueOnce(false);
    const reconnect = await connectRawClient(paths.endpoint);
    reconnect.send(helloEnvelope(TEST_TOKEN));
    expect(await reconnect.nextMessage()).toMatchObject({
      status: "rejected",
      error: { code: "external.unauthorized" }
    });
    expect(confirmClient).toHaveBeenCalledTimes(2);
  });

  it.runIf(onUnix)("keeps the state file private", async () => {
    await control.sync(true);
    expect((await stat(paths.stateFile)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.directory)).mode & 0o777).toBe(0o700);
  });

  it("removes the endpoint when switched off", async () => {
    await control.sync(true);
    await control.sync(false);
    expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
    await expect(connectRawClient(paths.endpoint)).rejects.toThrow();
  });

  it("uses a new token after being switched back on", async () => {
    await control.sync(true);
    await control.sync(false);
    token = "b".repeat(64);
    await control.sync(true);
    expect(await readExternalControlState(paths.stateFile)).toMatchObject({
      token
    });
  });

  it("stays silent about a launch until settings are known", async () => {
    await control.noteLaunchRequest();
    expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
    await control.sync(true);
    expect((await readExternalControlState(paths.stateFile))?.status).toBe(
      "ready"
    );
  });

  it("tells a launching bridge that the switch is off", async () => {
    await control.noteLaunchRequest();
    await control.sync(false);
    const state = await readExternalControlState(paths.stateFile);
    expect(state?.status).toBe("disabled");
    expect(state).not.toHaveProperty("token");
  });

  it("replaces the disabled marker once the user opts in", async () => {
    await control.sync(false);
    await control.noteLaunchRequest();
    await control.sync(true);
    expect((await readExternalControlState(paths.stateFile))?.status).toBe(
      "ready"
    );
  });

  it("clears every trace on shutdown", async () => {
    await control.noteLaunchRequest();
    await control.sync(true);
    await control.stop();
    expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
    await control.sync(true);
    expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
  });

  it("clears a state file left behind by a crash", async () => {
    await writeExternalControlState(paths.stateFile, {
      status: "disabled",
      protocolVersion: 1,
      appVersion: "0.9.0",
      pid: 1
    });
    await control.sync(false);
    expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
  });

  it("recovers from a failed start on the next change", async () => {
    const warn = vi.fn();
    const failing = createExternalControl({
      ...testControlOptions(paths),
      paths: { ...paths, endpoint: `${paths.directory}/missing/control.sock` },
      app: testAppState({ dataDirectory: () => paths.directory }),
      warn
    });
    if (onUnix) {
      await failing.sync(true);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).not.toContain(paths.directory);
      expect(await readExternalControlState(paths.stateFile)).toBeUndefined();
    }
    await failing.stop();
  });
});
