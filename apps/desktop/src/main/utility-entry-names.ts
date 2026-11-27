import type { UtilityWorkerName } from "@deepwrite/contracts";

export const UTILITY_ENTRY_NAMES = {
  core: "utilities/core-entry",
  agent: "utilities/agent-entry",
  tool: "utilities/tool-entry"
} satisfies Record<UtilityWorkerName, string>;
