import {
  BookTitleDesignProfileSchema,
  BookSynopsisDesignProfileSchema,
  BookCoverDesignProfileSchema
} from "../book-identity/profiles";
import { z } from "zod";
import { LongBookDecompositionProfileSchema } from "../long-book-decomposition/profile";
import { LONG_BOOK_ANALYSIS_MAX_PERSISTED_PRESETS } from "../long-book-analysis-limits";
import { LongBookAnalysisPresetSchema } from "../long-book-analysis-presets";
import { REVISION_METHOD_LIMIT } from "../revision-analysis";
import { ShortBookAnalysisPresetSchema } from "../short-book-analysis-presets";
import { STYLE_COMPARISON_METHOD_LIMIT } from "../style-comparison";
import {
  ChatNormalProfileSchema,
  ChatProjectProfileInputSchema,
  ChatProjectProfileSchema,
  ChatRoleplayProfileSchema
} from "./chat";
import { ExtrasAgentIdSchema, ExtrasAgentProfileIdSchema } from "./ids";
import type { ExtrasAgentId } from "./ids";

const PromptProfileBaseSchema = z.object({
  id: ExtrasAgentProfileIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  builtin: z.boolean().optional()
});

export const RevisionAnalysisProfileSchema = PromptProfileBaseSchema.extend({
  systemPrompt: z.string().trim().min(1).max(REVISION_METHOD_LIMIT)
});
export type RevisionAnalysisProfile = z.infer<
  typeof RevisionAnalysisProfileSchema
>;

/** The system prompt is the user's comparison method; empty means default. */
export const StyleComparisonProfileSchema = PromptProfileBaseSchema.extend({
  systemPrompt: z.string().trim().max(STYLE_COMPARISON_METHOD_LIMIT)
});
export type StyleComparisonProfile = z.infer<
  typeof StyleComparisonProfileSchema
>;

export const LONG_MATERIAL_GUIDE_FOCUS_LIMIT = 8_000;
/** The prompt is the user's focus note; the run boundary stays fixed. */
export const LongMaterialGuideProfileSchema = PromptProfileBaseSchema.extend({
  systemPrompt: z.string().trim().max(LONG_MATERIAL_GUIDE_FOCUS_LIMIT)
});
export type LongMaterialGuideProfile = z.infer<
  typeof LongMaterialGuideProfileSchema
>;

/**
 * A profile is the user-editable half of an extras agent: its system prompt
 * plus feature options such as the library an analysis result is saved to.
 * Tools and the non-editable run boundary stay in the agent definition.
 */
export const EXTRAS_AGENT_PROFILE_SCHEMAS = {
  "book-title-design": BookTitleDesignProfileSchema,
  "book-synopsis-design": BookSynopsisDesignProfileSchema,
  "book-cover-design": BookCoverDesignProfileSchema,
  "revision-analysis": RevisionAnalysisProfileSchema,
  "short-book-analysis": ShortBookAnalysisPresetSchema,
  "long-book-analysis": LongBookAnalysisPresetSchema,
  "long-book-decomposition": LongBookDecompositionProfileSchema,
  "long-material-guide": LongMaterialGuideProfileSchema,
  "style-comparison": StyleComparisonProfileSchema,
  "chat-normal": ChatNormalProfileSchema,
  "chat-project": ChatProjectProfileSchema,
  "chat-roleplay": ChatRoleplayProfileSchema
} as const;
export type ExtrasAgentProfile<A extends ExtrasAgentId = ExtrasAgentId> =
  z.infer<(typeof EXTRAS_AGENT_PROFILE_SCHEMAS)[A]>;

export const EXTRAS_AGENT_MAX_PROFILES: Record<ExtrasAgentId, number> = {
  "book-title-design": 20,
  "book-synopsis-design": 20,
  "book-cover-design": 20,
  "revision-analysis": 20,
  "short-book-analysis": 50,
  "long-book-analysis": LONG_BOOK_ANALYSIS_MAX_PERSISTED_PRESETS,
  "long-book-decomposition": 20,
  "long-material-guide": 20,
  "style-comparison": 20,
  "chat-normal": 20,
  "chat-project": 10_000,
  "chat-roleplay": 1000
};

function validateProfileList(
  profiles: readonly { id: string; name: string }[],
  uniqueNames: boolean,
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  profiles.forEach((profile, index) => {
    const name = profile.name.trim().toLocaleLowerCase("zh-CN");
    if (ids.has(profile.id) || (uniqueNames && names.has(name))) {
      context.addIssue({
        code: "custom",
        path: ["profiles", index],
        message: "预设名称和标识不能重复。"
      });
    }
    ids.add(profile.id);
    names.add(name);
  });
}

function settingsVariant<
  A extends ExtrasAgentId,
  P extends z.ZodType<{ id: string; name: string }>
>(agentId: A, profile: P, options: { uniqueNames?: boolean } = {}) {
  return z
    .object({
      agentId: z.literal(agentId),
      profiles: z.array(profile).max(EXTRAS_AGENT_MAX_PROFILES[agentId]),
      updatedAt: z.string().datetime().optional()
    })
    .superRefine((value, context) =>
      validateProfileList(value.profiles, options.uniqueNames ?? true, context)
    );
}

export const ExtrasAgentSettingsSchema = z.discriminatedUnion("agentId", [
  settingsVariant("book-title-design", BookTitleDesignProfileSchema),
  settingsVariant("book-synopsis-design", BookSynopsisDesignProfileSchema),
  settingsVariant("book-cover-design", BookCoverDesignProfileSchema),
  settingsVariant("revision-analysis", RevisionAnalysisProfileSchema),
  settingsVariant("short-book-analysis", ShortBookAnalysisPresetSchema),
  settingsVariant("long-book-analysis", LongBookAnalysisPresetSchema),
  settingsVariant(
    "long-book-decomposition",
    LongBookDecompositionProfileSchema
  ),
  settingsVariant("long-material-guide", LongMaterialGuideProfileSchema),
  settingsVariant("style-comparison", StyleComparisonProfileSchema),
  settingsVariant("chat-normal", ChatNormalProfileSchema),
  // Projects and roles may share display names; ids keep them apart.
  settingsVariant("chat-project", ChatProjectProfileSchema, {
    uniqueNames: false
  }),
  settingsVariant("chat-roleplay", ChatRoleplayProfileSchema, {
    uniqueNames: false
  })
]);
export type ExtrasAgentSettings = z.infer<typeof ExtrasAgentSettingsSchema>;
export type ExtrasAgentSettingsOf<A extends ExtrasAgentId> = Extract<
  ExtrasAgentSettings,
  { agentId: A }
>;

const withoutBuiltin = { builtin: true } as const;
export const ExtrasAgentSettingsInputSchema = z.discriminatedUnion("agentId", [
  settingsVariant(
    "book-title-design",
    BookTitleDesignProfileSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "book-synopsis-design",
    BookSynopsisDesignProfileSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "book-cover-design",
    BookCoverDesignProfileSchema.safeExtend({ builtin: z.never().optional() })
  ),
  settingsVariant(
    "revision-analysis",
    RevisionAnalysisProfileSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "short-book-analysis",
    ShortBookAnalysisPresetSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "long-book-analysis",
    LongBookAnalysisPresetSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "long-book-decomposition",
    LongBookDecompositionProfileSchema.safeExtend({
      builtin: z.never().optional()
    })
  ),
  settingsVariant(
    "long-material-guide",
    LongMaterialGuideProfileSchema.omit(withoutBuiltin)
  ),
  settingsVariant(
    "style-comparison",
    StyleComparisonProfileSchema.omit(withoutBuiltin)
  ),
  settingsVariant("chat-normal", ChatNormalProfileSchema.omit(withoutBuiltin)),
  settingsVariant("chat-project", ChatProjectProfileInputSchema, {
    uniqueNames: false
  }),
  settingsVariant(
    "chat-roleplay",
    ChatRoleplayProfileSchema.omit(withoutBuiltin),
    { uniqueNames: false }
  )
]);
export type ExtrasAgentSettingsInput = z.infer<
  typeof ExtrasAgentSettingsInputSchema
>;
export type ExtrasAgentSettingsInputOf<A extends ExtrasAgentId> = Extract<
  ExtrasAgentSettingsInput,
  { agentId: A }
>;

export const ExtrasAgentSettingsResetInputSchema = z.object({
  agentId: ExtrasAgentIdSchema,
  profileId: ExtrasAgentProfileIdSchema.optional()
});
export type ExtrasAgentSettingsResetInput = z.infer<
  typeof ExtrasAgentSettingsResetInputSchema
>;
