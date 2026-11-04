import {
  EXTERNAL_CONTROL_HELLO_MAX_BYTES,
  EXTERNAL_CONTROL_MESSAGE_MAX_BYTES,
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlCallEnvelopeSchema,
  ExternalControlHelloEnvelopeSchema,
  type ExternalControlClient,
  type ExternalControlErrorCode,
  type ExternalControlResult
} from "@deepwrite/contracts/external-control";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { ExternalControlError } from "./errors";
import { createLineReader, encodeLine } from "./line-framing";

const HELLO_TIMEOUT_MS = 5_000;
const MAX_CONNECTIONS = 16;
const UNIDENTIFIED_REQUEST = "unidentified";

export interface ExternalControlServerOptions {
  endpoint: string;
  token: string;
  platform?: NodeJS.Platform;
  /** Runs after the token is accepted; a rejection refuses the connection. */
  authorize(client: ExternalControlClient): Promise<void>;
  handleCall(
    tool: string,
    args: Record<string, unknown>,
    client: ExternalControlClient
  ): Promise<unknown>;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function rejected(
  requestId: string,
  code: ExternalControlErrorCode,
  message: string
): ExternalControlResult {
  return { status: "rejected", requestId, error: { code, message } };
}

export function createExternalControlServer(
  options: ExternalControlServerOptions
) {
  const platform = options.platform ?? process.platform;
  const expectedToken = digest(options.token);
  const sockets = new Set<Socket>();
  const clients = new Map<Socket, string>();
  let server: Server | undefined;

  function serve(socket: Socket): void {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      clients.delete(socket);
    });

    let client: ExternalControlClient | undefined;
    let helloStarted = false;
    const send = (result: ExternalControlResult): void => {
      if (socket.writable) socket.write(encodeLine(result));
    };
    const refuse = (result: ExternalControlResult): void => {
      send(result);
      socket.end();
    };
    const helloTimer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);
    socket.on("close", () => clearTimeout(helloTimer));

    function hello(line: string): void {
      const parsed = ExternalControlHelloEnvelopeSchema.safeParse(
        parseJson(line)
      );
      if (!parsed.success) {
        refuse(
          rejected(
            UNIDENTIFIED_REQUEST,
            "external.unauthorized",
            "连接未通过认证。"
          )
        );
        return;
      }
      const { id, payload } = parsed.data;
      if (!timingSafeEqual(digest(payload.token), expectedToken)) {
        refuse(
          rejected(
            id,
            "external.unauthorized",
            "连接令牌无效。请重新连接 DeepWrite。"
          )
        );
        return;
      }
      if (payload.protocolVersion !== EXTERNAL_CONTROL_PROTOCOL_VERSION) {
        refuse(
          rejected(
            id,
            "external.incompatible",
            "MCP 桥接与 DeepWrite 版本不匹配。请到设置里重新复制接入配置。"
          )
        );
        return;
      }
      // The user may take far longer to answer than the hello timeout allows.
      clearTimeout(helloTimer);
      clients.set(socket, payload.client.name);
      options.authorize(payload.client).then(
        () => {
          if (socket.destroyed) return;
          client = payload.client;
          send({
            status: "accepted",
            requestId: id,
            payload: { protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION }
          });
        },
        (error: unknown) =>
          refuse(
            error instanceof ExternalControlError
              ? rejected(id, error.code, error.message)
              : rejected(
                  id,
                  "external.not_ready",
                  "DeepWrite 暂时无法确认这次连接。请稍后重试。"
                )
          )
      );
    }

    async function call(
      line: string,
      caller: ExternalControlClient
    ): Promise<void> {
      const parsed = ExternalControlCallEnvelopeSchema.safeParse(
        parseJson(line)
      );
      if (!parsed.success) {
        send(
          rejected(
            UNIDENTIFIED_REQUEST,
            "external.invalid_input",
            "无法解析调用请求。"
          )
        );
        return;
      }
      const { id, payload } = parsed.data;
      try {
        const result = await options.handleCall(
          payload.tool,
          payload.arguments,
          caller
        );
        send({ status: "accepted", requestId: id, payload: result });
      } catch (error: unknown) {
        send(
          error instanceof ExternalControlError
            ? rejected(id, error.code, error.message)
            : rejected(
                id,
                "external.not_ready",
                "DeepWrite 暂时无法完成这次操作。请稍后重试。"
              )
        );
      }
    }

    const reader = createLineReader({
      maxBytes: () =>
        client
          ? EXTERNAL_CONTROL_MESSAGE_MAX_BYTES
          : EXTERNAL_CONTROL_HELLO_MAX_BYTES,
      onLine: (line) => {
        if (socket.destroyed) return;
        if (client) void call(line, client);
        else if (!helloStarted) {
          helloStarted = true;
          hello(line);
        }
      },
      onOverflow: () =>
        refuse(
          rejected(
            UNIDENTIFIED_REQUEST,
            "external.invalid_input",
            "消息超过大小限制。"
          )
        )
    });
    socket.on("data", (chunk: Buffer) => reader.push(chunk));
  }

  return {
    async start(): Promise<void> {
      if (server) return;
      // Single-instance locking means a leftover socket has no live owner.
      if (platform !== "win32") await rm(options.endpoint, { force: true });
      const instance = createServer(serve);
      instance.maxConnections = MAX_CONNECTIONS;
      await new Promise<void>((resolve, reject) => {
        instance.once("error", reject);
        instance.listen(options.endpoint, () => {
          instance.off("error", reject);
          resolve();
        });
      });
      if (platform !== "win32") await chmod(options.endpoint, 0o600);
      server = instance;
    },

    disconnectClient(name: string): void {
      for (const [socket, clientName] of clients) {
        if (clientName === name) socket.destroy();
      }
    },

    async stop(): Promise<void> {
      const instance = server;
      server = undefined;
      if (!instance) return;
      const closed = new Promise<void>((resolve) =>
        instance.close(() => resolve())
      );
      for (const socket of sockets) socket.destroy();
      await closed;
    }
  };
}

export type ExternalControlServer = ReturnType<
  typeof createExternalControlServer
>;
