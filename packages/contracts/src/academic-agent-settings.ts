import { z } from "zod";
import {
  BUILTIN_AGENT_METADATA,
  DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS
} from "./builtin-agent-metadata";
import { EnvelopeBaseSchema } from "./envelope";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";
import {
  SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  ShortAgentSubagentModelModeSchema,
  validateSubagentCustomModel
} from "./agent-team";

export const ACADEMIC_AGENT_IDS = ["academic"] as const;
export const AcademicAgentIdSchema = z.enum(ACADEMIC_AGENT_IDS);
export type AcademicAgentId = z.infer<typeof AcademicAgentIdSchema>;

export const ACADEMIC_AGENT_WELCOME_SHORTCUT_MAX_LENGTH = 120;
const AcademicWelcomeShortcutItemSchema = z
  .string()
  .trim()
  .min(1)
  .max(ACADEMIC_AGENT_WELCOME_SHORTCUT_MAX_LENGTH);

export const AcademicAgentWelcomeShortcutsSchema = z.tuple([
  AcademicWelcomeShortcutItemSchema,
  AcademicWelcomeShortcutItemSchema,
  AcademicWelcomeShortcutItemSchema
]);
export type AcademicAgentWelcomeShortcuts = z.infer<
  typeof AcademicAgentWelcomeShortcutsSchema
>;

export const AcademicAgentProfileSchema = z
  .object({
    workspaceType: z.literal("academic"),
    id: AcademicAgentIdSchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(320),
    systemPrompt: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH),
    welcomeShortcuts: AcademicAgentWelcomeShortcutsSchema.default(
      () =>
        [...DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS] as [
          string,
          string,
          string
        ]
    ),
    modelMode: ShortAgentSubagentModelModeSchema.default("inherit"),
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH)
      .optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    builtin: z.literal(true).optional()
  })
  .strict()
  .superRefine((value, context) => validateSubagentCustomModel(value, context));
export type AcademicAgentProfile = z.infer<typeof AcademicAgentProfileSchema>;

function validateCompleteAcademicAgentSet(
  agents: readonly { id: AcademicAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = agents.map((agent) => agent.id);
  for (const id of ACADEMIC_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["agents"],
        message: `Missing academic workspace agent profile: ${id}`
      });
    }
  }
}

function validateImmutableAcademicAgentFields(
  agents: readonly AcademicAgentProfile[],
  context: z.core.$RefinementCtx<unknown>
): void {
  agents.forEach((agent, index) => {
    const builtin = BUILTIN_AGENT_METADATA[agent.id];
    if (
      agent.label !== builtin.label ||
      agent.description !== builtin.description
    ) {
      context.addIssue({
        code: "custom",
        path: ["agents", index],
        message: `Academic agent identity metadata is immutable: ${agent.id}`
      });
    }
  });
}

export const AcademicAgentSettingsSchema = z
  .object({
    workspaceType: z.literal("academic"),
    agents: z
      .array(AcademicAgentProfileSchema)
      .length(ACADEMIC_AGENT_IDS.length)
  })
  .strict()
  .superRefine((value, context) => {
    validateCompleteAcademicAgentSet(value.agents, context);
    validateImmutableAcademicAgentFields(value.agents, context);
  });
export type AcademicAgentSettings = z.infer<typeof AcademicAgentSettingsSchema>;

export const AcademicAgentSettingsInputAgentSchema = z
  .object({
    id: AcademicAgentIdSchema,
    systemPrompt: AcademicAgentProfileSchema.shape.systemPrompt,
    welcomeShortcuts: AcademicAgentWelcomeShortcutsSchema,
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
  .strict()
  .superRefine((value, context) => validateSubagentCustomModel(value, context));
export type AcademicAgentSettingsInputAgent = z.infer<
  typeof AcademicAgentSettingsInputAgentSchema
>;

export const AcademicAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("academic"),
    agents: z
      .array(AcademicAgentSettingsInputAgentSchema)
      .length(ACADEMIC_AGENT_IDS.length),
    baseAgents: z
      .array(AcademicAgentSettingsInputAgentSchema)
      .length(ACADEMIC_AGENT_IDS.length)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    validateCompleteAcademicAgentSet(value.agents, context);
    if (value.baseAgents) {
      validateCompleteAcademicAgentSet(value.baseAgents, context);
    }
  });
export type AcademicAgentSettingsInput = z.infer<
  typeof AcademicAgentSettingsInputSchema
>;

export const AcademicAgentsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("academicAgents.list"),
    payload: z.object({}).strict()
  });
export type AcademicAgentsListCommandEnvelope = z.infer<
  typeof AcademicAgentsListCommandEnvelopeSchema
>;

export const AcademicAgentsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("academicAgents.save"),
    payload: AcademicAgentSettingsInputSchema
  });
export type AcademicAgentsSaveCommandEnvelope = z.infer<
  typeof AcademicAgentsSaveCommandEnvelopeSchema
>;

export const AcademicAgentsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("academicAgents.reset"),
    payload: z
      .object({
        agentId: AcademicAgentIdSchema.optional()
      })
      .strict()
  });
export type AcademicAgentsResetCommandEnvelope = z.infer<
  typeof AcademicAgentsResetCommandEnvelopeSchema
>;
