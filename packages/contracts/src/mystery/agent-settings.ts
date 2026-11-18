import { z } from "zod";
import { MATERIAL_KINDS, SKILL_KINDS } from "../catalog";
import { EnvelopeBaseSchema } from "../envelope";

export const MYSTERY_AGENT_IDS = ["mystery"] as const;
export const MysteryAgentIdSchema = z.enum(MYSTERY_AGENT_IDS);
export type MysteryAgentId = z.infer<typeof MysteryAgentIdSchema>;

export const MysteryAgentProfileSchema = z
  .object({
    workspaceType: z.literal("mystery"),
    id: MysteryAgentIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    systemPrompt: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => value.trim().length > 0, {
        message: "Mystery agent system prompt must contain non-whitespace text."
      }),
    welcomeShortcuts: z.tuple([
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200)
    ])
  })
  .strict();
export type MysteryAgentProfile = z.infer<typeof MysteryAgentProfileSchema>;

export const MYSTERY_AGENT_DEFAULT_MATERIAL_KINDS = [...MATERIAL_KINDS];
export const MYSTERY_AGENT_DEFAULT_SKILL_KINDS = [...SKILL_KINDS];

export const MysteryAgentSettingsSchema = z
  .object({
    workspaceType: z.literal("mystery"),
    agents: z.array(MysteryAgentProfileSchema).length(MYSTERY_AGENT_IDS.length)
  })
  .strict();
export type MysteryAgentSettings = z.infer<typeof MysteryAgentSettingsSchema>;

export const MysteryAgentSettingsInputAgentSchema = z
  .object({
    id: MysteryAgentIdSchema,
    systemPrompt: MysteryAgentProfileSchema.shape.systemPrompt,
    welcomeShortcuts: MysteryAgentProfileSchema.shape.welcomeShortcuts
  })
  .strict();
export type MysteryAgentSettingsInputAgent = z.infer<
  typeof MysteryAgentSettingsInputAgentSchema
>;

export const MysteryAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("mystery"),
    agents: z
      .array(MysteryAgentSettingsInputAgentSchema)
      .length(MYSTERY_AGENT_IDS.length),
    baseAgents: z
      .array(MysteryAgentSettingsInputAgentSchema)
      .length(MYSTERY_AGENT_IDS.length)
      .optional()
  })
  .strict();
export type MysteryAgentSettingsInput = z.infer<
  typeof MysteryAgentSettingsInputSchema
>;

export const MysteryAgentsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("mysteryAgents.list"),
    payload: z.object({}).strict()
  }
);
export const MysteryAgentsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("mysteryAgents.save"),
    payload: MysteryAgentSettingsInputSchema
  }
);
export const MysteryAgentsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("mysteryAgents.reset"),
    payload: z
      .object({
        agentId: MysteryAgentIdSchema.optional()
      })
      .strict()
  });
