import {
  EXTERNAL_CONTROL_TOOLS,
  externalControlToolInputJsonSchema
} from "@deepwrite/contracts/external-control";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { version } from "../../../package.json";
import { AppUpdatingError, createBridgeConnection } from "./bridge-connection";
import {
  isPackagedBridge,
  launchApp,
  resolveAppLaunchCommand
} from "./bridge-launch";
import {
  DEVELOPMENT_CONTROL_DIRECTORY_ENV,
  resolveExternalControlPaths
} from "./control-paths";
import { readExternalControlState } from "./control-state-file";
import { ExternalControlError } from "./errors";

/** Runs with ELECTRON_RUN_AS_NODE. Stdout carries MCP only: never log to it. */
const paths = resolveExternalControlPaths({
  homeDirectory: homedir(),
  packaged: isPackagedBridge(import.meta.url),
  developmentDirectory: process.env[DEVELOPMENT_CONTROL_DIRECTORY_ENV]
});

function logBridgeError(prefix: string, error: unknown): void {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[deepwrite-mcp] ${prefix}: ${detail}\n`);
}

const server = new Server(
  { name: "deepwrite", version },
  {
    capabilities: { tools: {} },
    instructions:
      "Operates the user's running DeepWrite writing app. Call get_app_status first; DeepWrite starts automatically when it is not running. Call restart_app if DeepWrite needs to restart; the bridge waits and reconnects automatically."
  }
);

server.onerror = (error) => {
  logBridgeError("MCP server error", error);
};

const connection = createBridgeConnection({
  readState: () => readExternalControlState(paths.stateFile),
  launch: () =>
    launchApp(
      resolveAppLaunchCommand({
        execPath: process.execPath,
        moduleUrl: import.meta.url,
        env: process.env
      })
    ),
  client: () => {
    const client = server.getClientVersion();
    return {
      name: client?.name?.trim() || "unknown",
      ...(client?.version?.trim() ? { version: client.version.trim() } : {})
    };
  }
});

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: EXTERNAL_CONTROL_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: externalControlToolInputJsonSchema(tool),
    annotations: tool.annotations
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await connection.call(
      request.params.name,
      request.params.arguments ?? {}
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error: unknown) {
    // This process runs the app's own binary; exiting frees it for the installer.
    if (error instanceof AppUpdatingError) setTimeout(shutdown, 500);
    const text =
      error instanceof ExternalControlError
        ? `${error.code}: ${error.message}`
        : `external.app_unavailable: 无法连接 DeepWrite。请让用户手动打开软件后重试。`;
    return { isError: true, content: [{ type: "text", text }] };
  }
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  connection.close();
  process.exit(0);
}

// An open control socket would otherwise outlive the MCP client.
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
    shutdown();
  } else {
    logBridgeError("stdout error", error);
  }
});
process.on("unhandledRejection", (reason) => {
  logBridgeError("Unhandled rejection", reason);
});
process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
  logBridgeError("Uncaught exception", error);
  if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
    shutdown();
  }
});

await server.connect(new StdioServerTransport());
