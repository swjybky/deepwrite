import type { CommandResult } from "@deepwrite/contracts";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";
import type { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  listActiveTeamPrompts,
  readActiveTeamPrompt
} from "./agent-team-prompt-management";
import { teamPromptReviews } from "./team-prompt-reviews";

export async function handleTeamManagementCommand(
  context: UtilityInternalCommandAuthorizationContext,
  activeRuns: ReadonlyMap<string, MainInternalCommandActiveRun>,
  store: () => Pick<AgentTeamConfigStore, "list" | "applyActivePrompt">,
  changed: (teamId: string) => void
): Promise<CommandResult | undefined> {
  const command = context.message.command;
  if (
    command.type !== "agentTeams.listActivePrompts" &&
    command.type !== "agentTeams.readActivePrompt" &&
    command.type !== "agentTeams.applyActivePrompt"
  )
    return undefined;
  try {
    if (authorizeMainInternalCommand(context, activeRuns) !== true)
      throw new Error("团队提示词操作未通过当前作品运行授权。");
    const config = store();
    let snapshot = await config.list();
    if (!snapshot.builtinSubagents.team.enabled)
      throw new Error("智能体团队管理已停用。");
    if (command.type === "agentTeams.listActivePrompts")
      return {
        status: "accepted",
        requestId: command.id,
        payload: listActiveTeamPrompts(snapshot, command.payload.scope)
      };
    if (command.type === "agentTeams.applyActivePrompt") {
      const { reviewRequestId, ...change } = command.payload;
      teamPromptReviews.take(
        command.context.runId!,
        command.context.sessionId!,
        reviewRequestId,
        change
      );
      snapshot = await config.applyActivePrompt(change);
      changed(command.payload.teamId);
    }
    return {
      status: "accepted",
      requestId: command.id,
      payload: readActiveTeamPrompt(snapshot, command.payload)
    };
  } catch (error) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "agent_teams.prompt_management_failed",
        message: error instanceof Error ? error.message : "管理团队提示词失败。"
      }
    };
  }
}
