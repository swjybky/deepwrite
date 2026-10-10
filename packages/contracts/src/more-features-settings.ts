import { z } from "zod";

/** The default sidebar order; newly introduced features are appended for existing users. */
export const MORE_FEATURE_IDS = [
  "chat-assistant",
  "short-book-analysis",
  "long-book-analysis",
  "long-book-decomposition",
  "long-material-pack",
  "revision-analysis",
  "style-comparison",
  "book-identity",
  "agent-team-marketplace",
  "skill-marketplace",
  "device-sync",
  "cloud-backup",
  "zhuque-detection"
] as const;

export const MoreFeatureIdSchema = z.enum(MORE_FEATURE_IDS);
export type MoreFeatureId = z.infer<typeof MoreFeatureIdSchema>;

const MoreFeaturePreferenceSchema = z.object({
  id: MoreFeatureIdSchema,
  visible: z.boolean()
});
export type MoreFeaturePreference = z.infer<typeof MoreFeaturePreferenceSchema>;
export type MoreFeaturesSettings = MoreFeaturePreference[];

export function createDefaultMoreFeaturesSettings(): MoreFeaturesSettings {
  return MORE_FEATURE_IDS.map((id) => ({ id, visible: true }));
}

export const MoreFeaturesSettingsSchema = z
  .array(MoreFeaturePreferenceSchema)
  .max(MORE_FEATURE_IDS.length)
  .refine(
    (preferences) =>
      new Set(preferences.map(({ id }) => id)).size === preferences.length,
    "More feature IDs must be unique."
  )
  .transform((preferences) => {
    const configured = new Set(preferences.map(({ id }) => id));
    return [
      ...preferences,
      ...createDefaultMoreFeaturesSettings().filter(
        ({ id }) => !configured.has(id)
      )
    ];
  });
