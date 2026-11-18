import { z } from "zod";
import {
  ACADEMIC_AGENT_IDS,
  AcademicAgentIdSchema,
  type AcademicAgentId
} from "./academic-agent-settings";
import {
  AgentTeamParallelSubagentsSchema,
  ShortAgentSubagentDefinitionSchema,
  type ShortAgentSubagentDefinition
} from "./agent-team";

export const ACADEMIC_AGENT_SUBAGENT_MAX_COUNT = 60;

function validateUniqueAcademicSubagents(
  subagents: readonly ShortAgentSubagentDefinition[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  subagents.forEach((subagent, index) => {
    if (seenIds.has(subagent.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate subagent id: ${subagent.id}`
      });
    }
    seenIds.add(subagent.id);

    const normalizedName = subagent.name.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: `Duplicate subagent name: ${subagent.name}`
      });
    }
    seenNames.add(normalizedName);
  });
}

function validateCompleteAcademicAgentTeams(
  teams: readonly { parentAgentId: AcademicAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const seen = new Set<AcademicAgentId>();
  teams.forEach((team, index) => {
    if (seen.has(team.parentAgentId)) {
      context.addIssue({
        code: "custom",
        path: ["teams", index, "parentAgentId"],
        message: `Duplicate subagent team for parent agent: ${team.parentAgentId}`
      });
    }
    seen.add(team.parentAgentId);
  });
  for (const parentAgentId of ACADEMIC_AGENT_IDS) {
    if (!seen.has(parentAgentId)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing subagent team for parent agent: ${parentAgentId}`
      });
    }
  }
}

export const AcademicAgentTeamSchema = z.object({
  parentAgentId: AcademicAgentIdSchema,
  subagents: z
    .array(ShortAgentSubagentDefinitionSchema)
    .max(ACADEMIC_AGENT_SUBAGENT_MAX_COUNT)
    .superRefine(validateUniqueAcademicSubagents)
});
export type AcademicAgentTeam = z.infer<typeof AcademicAgentTeamSchema>;

export const AcademicAgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("academic"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z.array(AcademicAgentTeamSchema).length(ACADEMIC_AGENT_IDS.length)
  })
  .strict()
  .superRefine((value, context) => {
    validateCompleteAcademicAgentTeams(value.teams, context);
  });
export type AcademicAgentTeamSettings = z.infer<
  typeof AcademicAgentTeamSettingsSchema
>;

export const AcademicAgentTeamSettingsInputSchema =
  AcademicAgentTeamSettingsSchema;
export type AcademicAgentTeamSettingsInput = z.infer<
  typeof AcademicAgentTeamSettingsInputSchema
>;
