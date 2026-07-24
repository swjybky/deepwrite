import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";
import {
  SHORT_WORKSPACE_AGENT_IDS,
  ShortWorkspaceAgentIdSchema,
  type ShortWorkspaceAgentId
} from "./workspace";

export const SHORT_AGENT_SUBAGENT_MAX_COUNT = 20;
export const SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH = 120;
export const SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH = 80;
export const SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH = 1_000;
export const SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH = 20_000;
export const SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH = 120;

export const ShortAgentSubagentModelModeSchema = z.enum(["inherit", "custom"]);
export type ShortAgentSubagentModelMode = z.infer<
  typeof ShortAgentSubagentModelModeSchema
>;

export const ShortAgentSubagentDefinitionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
        "Subagent id may contain only letters, numbers, underscores, and hyphens."
      ),
    name: z.string().trim().min(1).max(SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH),
    description: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH),
    systemPrompt: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH),
    enabled: z.boolean(),
    modelMode: ShortAgentSubagentModelModeSchema.default("inherit"),
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH)
      .optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.modelMode !== "custom") return;
    if (!value.modelId) {
      context.addIssue({
        code: "custom",
        path: ["modelId"],
        message: "单独配置模型时必须选择模型。"
      });
    }
    if (value.thinkingLevel === undefined) {
      context.addIssue({
        code: "custom",
        path: ["thinkingLevel"],
        message: "单独配置模型时必须选择思考等级。"
      });
    } else if (value.thinkingLevel === "off" && value.temperature === undefined) {
      context.addIssue({
        code: "custom",
        path: ["temperature"],
        message: "思考等级关闭时必须选择温度。"
      });
    }
  });
export type ShortAgentSubagentDefinition = z.infer<
  typeof ShortAgentSubagentDefinitionSchema
>;

function validateUniqueSubagents(
  subagents: readonly ShortAgentSubagentDefinition[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Map<string, number>();
  const names = new Map<string, number>();
  subagents.forEach((subagent, index) => {
    const normalizedId = subagent.id.toLocaleLowerCase();
    const existingIdIndex = ids.get(normalizedId);
    if (existingIdIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate subagent id: ${subagent.id}`
      });
    } else {
      ids.set(normalizedId, index);
    }

    const normalizedName = subagent.name.toLocaleLowerCase();
    const existingNameIndex = names.get(normalizedName);
    if (existingNameIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: `Duplicate subagent name: ${subagent.name}`
      });
    } else {
      names.set(normalizedName, index);
    }
  });
}

export const ShortAgentSubagentDefinitionsSchema = z
  .array(ShortAgentSubagentDefinitionSchema)
  .max(SHORT_AGENT_SUBAGENT_MAX_COUNT)
  .superRefine(validateUniqueSubagents);

export const AgentTeamSchema = z.object({
  parentAgentId: ShortWorkspaceAgentIdSchema,
  subagents: ShortAgentSubagentDefinitionsSchema
});
export type AgentTeam = z.infer<typeof AgentTeamSchema>;

function validateCompleteAgentTeams(
  teams: readonly { parentAgentId: ShortWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["teams", index, "parentAgentId"],
        message: `Duplicate parent agent team: ${id}`
      });
    }
  });
  for (const id of SHORT_WORKSPACE_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing parent agent team: ${id}`
      });
    }
  }
}

export const AgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("short"),
    teams: z.array(AgentTeamSchema).length(SHORT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteAgentTeams(value.teams, context)
  );
export type AgentTeamSettings = z.infer<typeof AgentTeamSettingsSchema>;

export const AgentTeamSettingsInputSchema = AgentTeamSettingsSchema;
export type AgentTeamSettingsInput = z.infer<
  typeof AgentTeamSettingsInputSchema
>;

export const DEFAULT_AGENT_TEAM_SETTINGS: AgentTeamSettings = {
  workspaceType: "short",
  teams: SHORT_WORKSPACE_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: []
  }))
};

export const AgentTeamsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.list"),
  payload: z.object({ workspaceType: z.literal("short") })
});

export const AgentTeamsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.save"),
  payload: AgentTeamSettingsInputSchema
});

export type AgentTeamsListCommandEnvelope = z.infer<
  typeof AgentTeamsListCommandEnvelopeSchema
>;
export type AgentTeamsSaveCommandEnvelope = z.infer<
  typeof AgentTeamsSaveCommandEnvelopeSchema
>;
