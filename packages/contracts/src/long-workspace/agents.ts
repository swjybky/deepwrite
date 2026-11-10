import {
  BUILTIN_AGENT_METADATA,
  DEFAULT_LONG_AGENT_WELCOME_SHORTCUTS
} from "../builtin-agent-metadata";
import { z } from "zod";

import { LONG_AGENT_SYSTEM_PROMPTS } from "../agent-prompts/long";
import { MaterialKindSchema, SkillKindSchema } from "../catalog";
import { DEFAULT_PROMPT_LOCALE } from "../prompt-locale";

export const LONG_AGENT_IDS = ["long"] as const;
export const LongAgentIdSchema = z.enum(LONG_AGENT_IDS);
export type LongAgentId = z.infer<typeof LongAgentIdSchema>;

export const LONG_WORKSPACE_ROOTS = [
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongWorkspaceRootSchema = z.enum(LONG_WORKSPACE_ROOTS);
export type LongWorkspaceRoot = z.infer<typeof LongWorkspaceRootSchema>;

export const LONG_AGENT_CAPABILITIES = [
  "query_structure",
  "mutate_structure",
  "write_chapter_files",
  "commit_ledger"
] as const;
export const LongAgentCapabilitySchema = z.enum(LONG_AGENT_CAPABILITIES);
export type LongAgentCapability = z.infer<typeof LongAgentCapabilitySchema>;

function uniqueEnumValuesSchema<T extends string>(
  schema: z.ZodType<T>,
  maxLength: number,
  label: string
) {
  return z
    .array(schema)
    .max(maxLength)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
        seen.add(value);
      });
    });
}

export const LongAgentReadAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace root"
    ),
    materialKinds: uniqueEnumValuesSchema(
      MaterialKindSchema,
      5,
      "material kind"
    ),
    skillKinds: uniqueEnumValuesSchema(SkillKindSchema, 4, "skill kind")
  })
  .strict();
export type LongAgentReadAccess = z.infer<typeof LongAgentReadAccessSchema>;

export const LongAgentWriteAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace write root"
    ),
    capabilities: uniqueEnumValuesSchema(
      LongAgentCapabilitySchema,
      LONG_AGENT_CAPABILITIES.length,
      "long agent capability"
    )
  })
  .strict();
export type LongAgentWriteAccess = z.infer<typeof LongAgentWriteAccessSchema>;

export const LongAgentProfileSchema = z
  .object({
    workspaceType: z.literal("long"),
    id: LongAgentIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    systemPrompt: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => value.trim().length > 0, {
        message: "Long agent system prompt must contain non-whitespace text."
      }),
    welcomeShortcuts: z.tuple([
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200)
    ]),
    readAccess: LongAgentReadAccessSchema,
    writeAccess: LongAgentWriteAccessSchema
  })
  .strict()
  .superRefine((profile, context) => {
    profile.writeAccess.workspaceRoots.forEach((root, index) => {
      if (!profile.readAccess.workspaceRoots.includes(root)) {
        context.addIssue({
          code: "custom",
          path: ["writeAccess", "workspaceRoots", index],
          message:
            "A long-form agent cannot write a workspace root it cannot read."
        });
      }
    });
  });
export type LongAgentProfile = z.infer<typeof LongAgentProfileSchema>;

export const LONG_AGENT_ID = "long" as const satisfies LongAgentId;

export function resolveLongAgentIdForRoot(
  _root: LongWorkspaceRoot
): LongAgentId {
  return LONG_AGENT_ID;
}

/** Built-in long-form role prompt in the default prompt language; see `agent-prompts/long.ts`. */
export const DEFAULT_LONG_AGENT_SYSTEM_PROMPT =
  LONG_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE];

export const DEFAULT_LONG_AGENT_PROFILE: LongAgentProfile =
  LongAgentProfileSchema.parse({
    workspaceType: "long",
    id: LONG_AGENT_ID,
    ...BUILTIN_AGENT_METADATA.long,
    systemPrompt: DEFAULT_LONG_AGENT_SYSTEM_PROMPT,
    welcomeShortcuts: DEFAULT_LONG_AGENT_WELCOME_SHORTCUTS,
    readAccess: {
      workspaceRoots: [...LONG_WORKSPACE_ROOTS],
      materialKinds: ["character", "gimmick", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: [...LONG_WORKSPACE_ROOTS],
      capabilities: [...LONG_AGENT_CAPABILITIES]
    }
  });

export const DEFAULT_LONG_AGENT_PROFILES: readonly LongAgentProfile[] = [
  DEFAULT_LONG_AGENT_PROFILE
];

export function getDefaultLongAgentProfile(
  agentId: LongAgentId
): LongAgentProfile {
  const profile = DEFAULT_LONG_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing default long agent profile: ${agentId}`);
  }
  return structuredClone(profile);
}
