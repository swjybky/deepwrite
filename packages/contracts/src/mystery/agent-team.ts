import { z } from "zod";
import {
  AgentTeamParallelSubagentsSchema,
  ShortAgentSubagentDefinitionsSchema
} from "../agent-team";
import {
  MYSTERY_AGENT_IDS,
  MysteryAgentIdSchema,
  type MysteryAgentId
} from "./agent-settings";

export const MysteryAgentTeamSchema = z
  .object({
    parentAgentId: MysteryAgentIdSchema,
    subagents: ShortAgentSubagentDefinitionsSchema
  })
  .strict();
export type MysteryAgentTeam = z.infer<typeof MysteryAgentTeamSchema>;

function validateCompleteMysteryAgentTeams(
  teams: readonly { parentAgentId: MysteryAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  for (const id of MYSTERY_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing mystery parent agent team: ${id}`
      });
    }
  }
}

export const MysteryAgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("mystery"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z.array(MysteryAgentTeamSchema).length(MYSTERY_AGENT_IDS.length)
  })
  .strict()
  .superRefine((value, context) =>
    validateCompleteMysteryAgentTeams(value.teams, context)
  );
export type MysteryAgentTeamSettings = z.infer<
  typeof MysteryAgentTeamSettingsSchema
>;
