import {
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts-writing";
import {
  scriptReadOnlyRuntimeSystemRequirements,
  shortReadOnlyRuntimeSystemRequirements
} from "./prompts-writing-readonly";
import type { AgentRunInput } from "./runtime-types";
import type { ShortWorkspaceToolSharedState } from "./short-agent-tools";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import { currentWritingWorkspaceNavigation } from "./writing-workspace-directory";

/** Resolve after preceding children finish, rather than when tools are built. */
export function writingSubagentContext(
  input: AgentRunInput,
  state: ShortWorkspaceToolSharedState | undefined
): Pick<
  BuildSpawnSubagentToolInput,
  "systemPromptRequirements" | "pureReadSystemPromptRequirements"
> {
  const { scriptWorkspace, shortWorkspace } = input.workspaceContext ?? {};
  const currentInput = (): AgentRunInput => ({
    ...input,
    workspaceContext: {
      ...input.workspaceContext,
      ...(scriptWorkspace && state
        ? {
            scriptWorkspace: currentWritingWorkspaceNavigation(
              scriptWorkspace,
              state
            )
          }
        : shortWorkspace && state
          ? {
              shortWorkspace: currentWritingWorkspaceNavigation(
                shortWorkspace,
                state
              )
            }
          : {})
    }
  });
  const standard = scriptWorkspace
    ? scriptRuntimeSystemRequirements
    : shortRuntimeSystemRequirements;
  const readOnly = scriptWorkspace
    ? scriptReadOnlyRuntimeSystemRequirements
    : shortReadOnlyRuntimeSystemRequirements;
  return {
    systemPromptRequirements: (toolNames) =>
      standard(currentInput(), toolNames),
    pureReadSystemPromptRequirements: (toolNames) =>
      readOnly(currentInput(), toolNames)
  };
}
