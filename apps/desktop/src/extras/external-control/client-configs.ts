import type { ExternalControlOverview } from "@deepwrite/contracts/external-control";

export interface BridgeConnection {
  command: string;
  args: readonly string[];
}

const SERVER_NAME = "deepwrite";
const RUN_AS_NODE = "ELECTRON_RUN_AS_NODE=1";

function quoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function commandLine(connection: BridgeConnection): string {
  return [connection.command, ...connection.args]
    .map((part) => quoted(part))
    .join(" ");
}

/** Clients install through their own CLI where one exists: it knows its file. */
export function bridgeClientConfigs(
  connection: BridgeConnection
): ExternalControlOverview["configs"] {
  const server = {
    command: connection.command,
    args: connection.args,
    env: { ELECTRON_RUN_AS_NODE: "1" }
  };
  const yamlArgs = connection.args.map((arg) => `          - ${quoted(arg)}`);
  return [
    {
      id: "claude",
      label: "Claude Code",
      kind: "command",
      text: `claude mcp add --scope user ${SERVER_NAME} -e ${RUN_AS_NODE} -- ${commandLine(connection)}`
    },
    {
      id: "codex",
      label: "Codex",
      kind: "command",
      text: `codex mcp add ${SERVER_NAME} --env ${RUN_AS_NODE} -- ${commandLine(connection)}`
    },
    {
      id: "dsh",
      label: "DeepSeek Harness",
      kind: "file",
      file: "cordis.patch.yml",
      text: [
        "- insert:",
        `    - id: mcp-${SERVER_NAME}`,
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        `        serverName: ${SERVER_NAME}`,
        "        transport: stdio",
        `        command: ${quoted(connection.command)}`,
        "        args:",
        ...yamlArgs,
        "        env:",
        "          ELECTRON_RUN_AS_NODE: '1'"
      ].join("\n")
    },
    {
      id: "zcode",
      label: "ZCode",
      kind: "file",
      file: "~/.zcode/cli/config.json",
      text: JSON.stringify(
        { mcp: { servers: { [SERVER_NAME]: server } } },
        null,
        2
      )
    },
    {
      id: "kimi",
      label: "Kimi Code",
      kind: "file",
      file: "~/.kimi-code/mcp.json",
      text: JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2)
    },
    {
      id: "generic",
      label: "JSON",
      kind: "file",
      text: JSON.stringify(
        {
          mcpServers: {
            [SERVER_NAME]: {
              command: connection.command,
              args: connection.args,
              env: { ELECTRON_RUN_AS_NODE: "1" }
            }
          }
        },
        null,
        2
      )
    }
  ];
}
