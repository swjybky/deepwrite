import {
  AgentTeamProfileSchema,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import basicLongDefaultTeamData from "./basic-long-default-team.json";

const BUILTIN_AGENT_TEAMS: readonly AgentTeamProfile[] = [
  AgentTeamProfileSchema.parse({
    ...basicLongDefaultTeamData,
    isBuiltin: true
  })
];

export function getBuiltinAgentTeams(): AgentTeamProfile[] {
  return structuredClone([...BUILTIN_AGENT_TEAMS]);
}
