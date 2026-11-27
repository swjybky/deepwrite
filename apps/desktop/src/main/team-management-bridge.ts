import {
  resolveModelKind,
  type AgentTeamModelChoice,
  type CommandResult,
  type ModelSettings
} from "@deepwrite/contracts";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";
import type { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  activeTeamRevision,
  listActiveTeams,
  previewActiveTeamChange,
  readActiveMembers
} from "./agent-team-active-management";
import { teamPromptReviews } from "./team-prompt-reviews";
import { rejectedResult } from "./ipc/errors";

/** Models a member may use; the agent only ever sees ids and run options. */
export function teamModelChoices(
  settings: ModelSettings
): AgentTeamModelChoice[] {
  const free = new Set(settings.deepwriteFreeEnabledModelIds ?? []);
  return [
    ...settings.models,
    ...(settings.deepwriteFreeModels ?? []).filter((model) =>
      free.has(model.id)
    )
  ].map((model) => ({
    id: model.id,
    label: model.label,
    kind: resolveModelKind(model),
    reasoning: model.reasoning,
    thinkingLevelOptions: [...model.thinkingLevelOptions],
    temperatureOptions: [...model.temperatureOptions]
  }));
}

export async function handleTeamManagementCommand(
  context: UtilityInternalCommandAuthorizationContext,
  activeRuns: ReadonlyMap<string, MainInternalCommandActiveRun>,
  store: () => Pick<AgentTeamConfigStore, "list" | "applyActiveChange">,
  changed: (teamId: string) => void,
  models: () => Promise<AgentTeamModelChoice[]>
): Promise<CommandResult | undefined> {
  const command = context.message.command;
  if (
    command.type !== "agentTeams.listActive" &&
    command.type !== "agentTeams.readActiveMembers" &&
    command.type !== "agentTeams.previewActiveChange" &&
    command.type !== "agentTeams.applyActiveChange"
  )
    return undefined;
  try {
    if (authorizeMainInternalCommand(context, activeRuns) !== true)
      throw new Error("团队管理操作未通过当前作品运行授权。");
    const config = store();
    const snapshot = await config.list();
    if (!snapshot.builtinSubagents.team.enabled)
      throw new Error("智能体团队管理已停用。");
    let payload: unknown;
    if (command.type === "agentTeams.listActive")
      payload = listActiveTeams(
        snapshot,
        command.payload.scope,
        await models()
      );
    else if (command.type === "agentTeams.readActiveMembers")
      payload = readActiveMembers(snapshot, command.payload);
    else if (command.type === "agentTeams.previewActiveChange")
      payload = previewActiveTeamChange(
        snapshot,
        command.payload,
        await models()
      );
    else {
      const { reviewRequestId, ...change } = command.payload;
      teamPromptReviews.take(
        command.context.runId!,
        command.context.sessionId!,
        reviewRequestId,
        change
      );
      const saved = await config.applyActiveChange(change, await models());
      changed(change.teamId);
      const team = saved.teams.find((item) => item.id === change.teamId)!;
      payload = { teamId: team.id, revision: activeTeamRevision(team) };
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      "agent_teams.team_management_failed",
      error instanceof Error ? error.message : "管理智能体团队失败。"
    );
  }
}
