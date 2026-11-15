import { createLongWorkspaceNavigationSnapshot } from "@deepwrite/contracts";
import { createLongToolContext } from "./long-agent-tools/context";
import type { LongWorkspaceToolSharedState } from "./long-agent-tools";
import { promptLocaleOf } from "./prompt-locale";
import { buildLongFollowUpContextLines } from "./prompts-long";
import {
  buildLongReadOnlyWorkspaceRules,
  buildLongWorkspaceRules
} from "./prompts-long-rules";
import type { AgentRunInput } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import { writeApprovalBoundary } from "./write-approval";

export function longSubagentContext(
  input: AgentRunInput,
  state: LongWorkspaceToolSharedState | undefined
): Pick<
  BuildSpawnSubagentToolInput,
  "systemPromptRequirements" | "pureReadSystemPromptRequirements"
> {
  const locale = promptLocaleOf(input);
  const workspace = input.workspaceContext?.longWorkspace;
  const context =
    workspace && input.longAgentProfile && input.longCommandExecutor
      ? createLongToolContext({
          workspace,
          profile: input.longAgentProfile,
          sessionId: input.sessionId,
          runId: input.runId,
          executor: input.longCommandExecutor,
          ...(state ? { sharedState: state } : {})
        })
      : undefined;
  const directory = async (): Promise<string> => {
    if (!workspace) return "";
    const navigation = context
      ? createLongWorkspaceNavigationSnapshot(
          await context.reloadIndex(input.signal)
        )
      : workspace.navigation;
    return buildLongFollowUpContextLines({ ...workspace, navigation })
      .filter(Boolean)
      .join("\n");
  };
  const delegated =
    locale === "en-US"
      ? "This is a single-level task delegated by the long-form main agent. Use only the inherited tools for this book. When handing back, list the changes you submitted."
      : "这是长篇主智能体委派的单层子任务。只能使用本书继承的工具，交回结果时列出已提交的修改。";
  const readOnly =
    locale === "en-US"
      ? "This is a single-level read-only task delegated by the long-form main agent. Use only the inherited query tools for this book. There are no write tools: never claim to have changed the work or committed to the continuity ledger."
      : "这是长篇主智能体委派的单层只读子任务。只能使用本书继承的查询工具；没有写入工具，不得声称已修改作品或已提交连续性账本。";
  return {
    systemPromptRequirements: async (toolNames) =>
      [
        buildLongWorkspaceRules(locale, toolNames),
        writeApprovalBoundary(input.writeApprovalMode, locale),
        await directory(),
        delegated
      ].join("\n\n"),
    pureReadSystemPromptRequirements: async () =>
      [
        buildLongReadOnlyWorkspaceRules(locale),
        await directory(),
        readOnly
      ].join("\n\n")
  };
}
