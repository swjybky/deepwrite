import { agentCommands } from "./commands/agent.mjs";
import { appCommands } from "./commands/app.mjs";
import { checkCommands } from "./commands/check.mjs";
import { dataCommands } from "./commands/data.mjs";
import { envCommands } from "./commands/env.mjs";
import { logsCommands } from "./commands/logs.mjs";
import { uiCommands } from "./commands/ui.mjs";

export const cliGroups = {
  env: envCommands,
  app: appCommands,
  logs: logsCommands,
  data: dataCommands,
  ui: uiCommands,
  agent: agentCommands,
  check: checkCommands
};
