import type {
  AgentTeamCatalogSnapshot,
  AgentTeamProfile
} from "@deepwrite/contracts";
import {
  ExternalListAgentTeamsResultSchema,
  type ExternalListAgentTeamsInput
} from "@deepwrite/contracts/external-control";
import { createHash } from "node:crypto";
import { ExternalControlError } from "./errors";

function teamSummary(
  team: AgentTeamProfile,
  enabledTeamIds: AgentTeamCatalogSnapshot["enabledTeamIds"]
) {
  return {
    id: team.id,
    name: team.name,
    type: team.workspaceType,
    enabled: enabledTeamIds[team.workspaceType] === team.id,
    fromMarketplace: team.marketplaceSource !== undefined
  };
}

/** Team settings carry no revision of their own, so their content is one. */
export function agentTeamRevision(team: AgentTeamProfile): string {
  return createHash("sha256")
    .update(JSON.stringify(team.settings))
    .digest("hex")
    .slice(0, 32);
}

export function listAgentTeams(
  snapshot: AgentTeamCatalogSnapshot,
  input: ExternalListAgentTeamsInput
) {
  const { enabledTeamIds, teams } = snapshot;
  const selected = input.teamId
    ? teams.find(({ id }) => id === input.teamId)
    : undefined;
  if (input.teamId && !selected) {
    throw new ExternalControlError(
      "external.not_found",
      "找不到这个智能体团队。请用 list_agent_teams 重新确认团队 ID。"
    );
  }
  return ExternalListAgentTeamsResultSchema.parse({
    teams: teams
      .filter((team) => !input.type || team.workspaceType === input.type)
      .map((team) => teamSummary(team, enabledTeamIds)),
    ...(selected
      ? {
          team: {
            ...teamSummary(selected, enabledTeamIds),
            settings: selected.settings,
            revision: agentTeamRevision(selected)
          }
        }
      : {})
  });
}
