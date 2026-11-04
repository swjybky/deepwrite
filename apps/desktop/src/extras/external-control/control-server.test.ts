import { EXTERNAL_CONTROL_HELLO_MAX_BYTES } from "@deepwrite/contracts/external-control";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExternalControlServer,
  type ExternalControlServer
} from "./control-server";
import type { ExternalControlPaths } from "./control-paths";
import { ExternalControlError } from "./errors";
import {
  TEST_TOKEN,
  callEnvelope,
  connectRawClient,
  createTestPaths,
  helloEnvelope
} from "./external-control.test-support";

const onUnix = process.platform !== "win32";

describe("external control server", () => {
  let paths: ExternalControlPaths;
  let cleanup: () => Promise<void>;
  let server: ExternalControlServer;
  const handleCall = vi.fn(async (tool: string): Promise<unknown> => ({
    echoed: tool
  }));
  const authorize = vi.fn(async (): Promise<void> => undefined);

  beforeEach(async () => {
    handleCall.mockClear();
    authorize.mockReset();
    authorize.mockResolvedValue(undefined);
    ({ paths, cleanup } = await createTestPaths());
    await mkdir(dirname(paths.stateFile), { recursive: true });
    server = createExternalControlServer({
      endpoint: paths.endpoint,
      token: TEST_TOKEN,
      authorize,
      handleCall
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await cleanup();
  });

  async function authenticated() {
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    expect(await client.nextMessage()).toMatchObject({ status: "accepted" });
    return client;
  }

  it("runs a call only after the token is accepted", async () => {
    const client = await authenticated();
    client.send(callEnvelope("call-1", "get_app_status"));
    expect(await client.nextMessage()).toEqual({
      status: "accepted",
      requestId: "call-1",
      payload: { echoed: "get_app_status" }
    });
    expect(handleCall).toHaveBeenCalledOnce();
  });

  it("disconnects every socket of a revoked client without affecting others", async () => {
    const first = await authenticated();
    const second = await authenticated();
    const other = await connectRawClient(paths.endpoint);
    const hello = helloEnvelope(TEST_TOKEN);
    hello.payload.client.name = "other-client";
    other.send(hello);
    expect(await other.nextMessage()).toMatchObject({ status: "accepted" });
    server.disconnectClient("test-client");
    await Promise.all([first.closed(), second.closed()]);
    other.send(callEnvelope("unaffected", "get_app_status"));
    expect(await other.nextMessage()).toMatchObject({
      status: "accepted",
      requestId: "unaffected"
    });
  });

  it("also disconnects a client whose authorization is still pending", async () => {
    let allow = (): void => undefined;
    authorize.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        allow = resolve;
      })
    );
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    server.disconnectClient("test-client");
    allow();
    await client.closed();
    expect(handleCall).not.toHaveBeenCalled();
  });

  it("closes the connection on a wrong token", async () => {
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope("wrong-token"));
    expect(await client.nextMessage()).toMatchObject({
      status: "rejected",
      error: { code: "external.unauthorized" }
    });
    await client.closed();
    expect(handleCall).not.toHaveBeenCalled();
  });

  it("passes the client to authorization only after the token", async () => {
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope("wrong-token"));
    await client.closed();
    expect(authorize).not.toHaveBeenCalled();

    const trusted = await authenticated();
    expect(authorize).toHaveBeenCalledWith({ name: "test-client" });
    trusted.socket.destroy();
  });

  it("refuses a client the user did not allow", async () => {
    authorize.mockRejectedValueOnce(
      new ExternalControlError("external.unauthorized", "用户拒绝了这次连接。")
    );
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    expect(await client.nextMessage()).toMatchObject({
      status: "rejected",
      requestId: "hello-1",
      error: { code: "external.unauthorized" }
    });
    await client.closed();
  });

  it("ignores calls sent while the user is still deciding", async () => {
    let allow = (): void => undefined;
    authorize.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        allow = resolve;
      })
    );
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN));
    client.send(callEnvelope("early", "get_app_status"));
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    allow();
    expect(await client.nextMessage()).toMatchObject({ status: "accepted" });
    client.send(callEnvelope("call-1", "get_app_status"));
    expect(await client.nextMessage()).toMatchObject({ requestId: "call-1" });
    expect(handleCall).toHaveBeenCalledOnce();
    client.socket.destroy();
  });

  it("does not treat a call before hello as authenticated", async () => {
    const client = await connectRawClient(paths.endpoint);
    client.send(callEnvelope("call-1", "get_app_status"));
    expect(await client.nextMessage()).toMatchObject({
      status: "rejected",
      error: { code: "external.unauthorized" }
    });
    await client.closed();
    expect(handleCall).not.toHaveBeenCalled();
  });

  it("refuses an incompatible protocol version", async () => {
    const client = await connectRawClient(paths.endpoint);
    client.send(helloEnvelope(TEST_TOKEN, 999));
    expect(await client.nextMessage()).toMatchObject({
      status: "rejected",
      error: { code: "external.incompatible" }
    });
    await client.closed();
  });

  it("drops an unauthenticated oversized message", async () => {
    const client = await connectRawClient(paths.endpoint);
    client.socket.write(Buffer.alloc(EXTERNAL_CONTROL_HELLO_MAX_BYTES + 1, 97));
    expect(await client.nextMessage()).toMatchObject({
      status: "rejected",
      error: { code: "external.invalid_input" }
    });
    await client.closed();
  });

  it("returns a tool error without dropping the connection", async () => {
    handleCall.mockRejectedValueOnce(
      new ExternalControlError("external.invalid_input", "参数错误")
    );
    const client = await authenticated();
    client.send(callEnvelope("call-1", "get_app_status"));
    expect(await client.nextMessage()).toMatchObject({
      requestId: "call-1",
      error: { code: "external.invalid_input", message: "参数错误" }
    });
    client.send(callEnvelope("call-2", "get_app_status"));
    expect(await client.nextMessage()).toMatchObject({
      status: "accepted",
      requestId: "call-2"
    });
  });

  it("hides internal error details from the client", async () => {
    handleCall.mockRejectedValueOnce(new Error("/private/path/secret"));
    const client = await authenticated();
    client.send(callEnvelope("call-1", "get_app_status"));
    const message = await client.nextMessage();
    expect(message).toMatchObject({ error: { code: "external.not_ready" } });
    expect(JSON.stringify(message)).not.toContain("/private/path");
  });

  it("disconnects open clients when stopped", async () => {
    const client = await authenticated();
    await server.stop();
    await client.closed();
    await expect(connectRawClient(paths.endpoint)).rejects.toThrow();
  });

  it.runIf(onUnix)("replaces a socket left by a crash", async () => {
    await server.stop();
    await writeFile(paths.endpoint, "");
    await server.start();
    const client = await authenticated();
    client.socket.destroy();
  });

  it.runIf(onUnix)("makes the socket private to its owner", async () => {
    const { mode } = await stat(paths.endpoint);
    expect(mode & 0o777).toBe(0o600);
  });
});
