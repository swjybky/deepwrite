import { createDefaultGeneralSettings } from "@deepwrite/contracts";
import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  createEnvelope
} from "@deepwrite/contracts/external-control";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveExternalControlPaths,
  type ExternalControlPaths
} from "./control-paths";
import { createLineReader, encodeLine } from "./line-framing";
import type { ExternalControlAppState } from "./tool-routes";

export const TEST_TOKEN = "a".repeat(64);

export function testAppState(
  overrides: Partial<ExternalControlAppState> = {}
): ExternalControlAppState {
  return {
    appVersion: "1.0.0",
    platform: "darwin",
    rendererReady: () => true,
    activeRunCount: () => 0,
    generalSettings: () => createDefaultGeneralSettings(),
    core: (command) =>
      Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: { code: "utility.not_running", message: "not running" }
      }),
    command: (command) =>
      Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: { code: "utility.not_running", message: "not running" }
      }),
    broadcastChange: () => undefined,
    windowRequest: () => Promise.resolve({ dirty: false }),
    agentTeams: () => Promise.reject(new Error("no agent teams in this test")),
    dataDirectory: () => join(tmpdir(), "deepwrite-unused-data"),
    ...overrides
  };
}

/** Every client already allowed, for tests about something else. */
export function testControlOptions(paths: ExternalControlPaths) {
  return {
    paths,
    homeDirectory: paths.directory,
    connection: () => ({
      command: "/example.test/DeepWrite",
      args: ["bridge.js"]
    }),
    sendWindowRequest: () => undefined,
    confirmClient: () => Promise.resolve(true)
  };
}

export async function createTestPaths(): Promise<{
  paths: ExternalControlPaths;
  cleanup(): Promise<void>;
}> {
  // os.tmpdir() keeps the path inside macOS's socket length limit.
  const homeDirectory = await mkdtemp(join(tmpdir(), "dw-ctl-"));
  return {
    paths: resolveExternalControlPaths({ homeDirectory, packaged: false }),
    cleanup: () =>
      rm(homeDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
  };
}

export function helloEnvelope(token: string, protocolVersion?: number) {
  return createEnvelope(
    "externalControl.hello",
    {
      protocolVersion: protocolVersion ?? EXTERNAL_CONTROL_PROTOCOL_VERSION,
      token,
      client: { name: "test-client" }
    },
    { id: "hello-1" }
  );
}

export function callEnvelope(
  id: string,
  tool: string,
  args: Record<string, unknown> = {}
) {
  return createEnvelope(
    "externalControl.call",
    { tool, arguments: args },
    { id }
  );
}

/** A raw protocol client, for what the real bridge would never send. */
export interface RawClient {
  socket: Socket;
  send(message: unknown): void;
  nextMessage(): Promise<Record<string, unknown>>;
  closed(): Promise<void>;
}

export async function connectRawClient(endpoint: string): Promise<RawClient> {
  const socket = connect(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  const queued: Record<string, unknown>[] = [];
  const waiting: ((message: Record<string, unknown>) => void)[] = [];
  const reader = createLineReader({
    maxBytes: () => 1024 * 1024,
    onLine: (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      const next = waiting.shift();
      if (next) next(message);
      else queued.push(message);
    },
    onOverflow: () => socket.destroy()
  });
  socket.on("data", (chunk: Buffer) => reader.push(chunk));
  socket.on("error", () => socket.destroy());
  const closed = new Promise<void>((resolve) =>
    socket.once("close", () => resolve())
  );
  return {
    socket,
    send: (message) => socket.write(encodeLine(message)),
    nextMessage: () => {
      const message = queued.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve) => waiting.push(resolve));
    },
    closed: () => closed
  };
}
