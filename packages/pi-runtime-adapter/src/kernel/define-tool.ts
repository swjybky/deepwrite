import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { piStrictToolSampling } from "../pi-tool-schema";

export function defineTool<T extends TSchema, Details>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<Details>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, Details> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    ...piStrictToolSampling(definition.parameters),
    execute: definition.execute,
    ...(definition.executionMode
      ? { executionMode: definition.executionMode }
      : {})
  };
}
