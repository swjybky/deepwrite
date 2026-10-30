import { z } from "zod";
import {
  BodyTextFormatsSchema,
  createDefaultBodyTextFormats
} from "./body-text-format";
import { EnvelopeBaseSchema } from "./envelope";
import { ContextCompactionSettingsSchema } from "./session/context-compaction-state";
import { createDefaultContextCompactionSettings } from "./session/context-compaction-defaults";
import { conversationPromptTokenLimit } from "./session/prompt-budget";
import {
  createDefaultMoreFeaturesSettings,
  MoreFeaturesSettingsSchema
} from "./more-features-settings";
import {
  PROMPT_TEXT_ATTACHMENT_DEFAULT_CONTENT_LENGTH,
  PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH
} from "./session/attachments";

/** Chinese prose is estimated at roughly one token per character. */
export function maxTextAttachmentCharactersForBudget(
  budgetTokens: number
): number {
  return Math.min(
    PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH,
    conversationPromptTokenLimit(budgetTokens)
  );
}

export const GeneralPermissionModeSchema = z.enum([
  "request-approval",
  "auto-approve"
]);
export type GeneralPermissionMode = z.infer<typeof GeneralPermissionModeSchema>;

export const AppLanguageSchema = z.enum(["auto", "zh-CN", "en-US"]);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;

export const WorkspacePaneLayoutSchema = z.enum([
  "agent-editor",
  "editor-agent"
]);
export type WorkspacePaneLayout = z.infer<typeof WorkspacePaneLayoutSchema>;

export const TextViewModeSchema = z.enum(["edit", "preview"]);
export type TextViewMode = z.infer<typeof TextViewModeSchema>;

export const GeneralSettingsSchema = z
  .object({
    permissionMode: GeneralPermissionModeSchema,
    autoApproveCrossStageOperations: z.boolean().default(true),
    autoSave: z.boolean(),
    language: AppLanguageSchema,
    showInMenuBar: z.boolean(),
    /** Show a system notification when an agent run or a task settles. */
    taskNotification: z.boolean().default(false),
    showContextUsage: z.boolean().default(true),
    textAttachmentMaxCharacters: z
      .number()
      .int()
      .min(1_000)
      .max(PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH)
      .default(PROMPT_TEXT_ATTACHMENT_DEFAULT_CONTENT_LENGTH),
    contextCompaction: ContextCompactionSettingsSchema.default(
      createDefaultContextCompactionSettings
    ),
    useNetworkProxy: z.boolean().default(false),
    workspacePaneLayout: WorkspacePaneLayoutSchema.default("agent-editor"),
    defaultTextViewMode: TextViewModeSchema.default("edit"),
    bodyTextFormats: BodyTextFormatsSchema.default(
      createDefaultBodyTextFormats
    ),
    moreFeatures: MoreFeaturesSettingsSchema.default(
      createDefaultMoreFeaturesSettings
    )
  })
  .transform((settings) => ({
    ...settings,
    textAttachmentMaxCharacters: Math.min(
      settings.textAttachmentMaxCharacters,
      maxTextAttachmentCharactersForBudget(
        settings.contextCompaction.budgetTokens
      )
    )
  }));
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const GeneralSettingsSnapshotSchema = z.object({
  persisted: z.boolean(),
  settings: GeneralSettingsSchema
});
export type GeneralSettingsSnapshot = z.infer<
  typeof GeneralSettingsSnapshotSchema
>;

export function createDefaultGeneralSettings(): GeneralSettings {
  return {
    permissionMode: "auto-approve",
    autoApproveCrossStageOperations: true,
    autoSave: true,
    language: "auto",
    showInMenuBar: true,
    taskNotification: false,
    showContextUsage: true,
    textAttachmentMaxCharacters: PROMPT_TEXT_ATTACHMENT_DEFAULT_CONTENT_LENGTH,
    contextCompaction: createDefaultContextCompactionSettings(),
    useNetworkProxy: false,
    workspacePaneLayout: "agent-editor",
    defaultTextViewMode: "edit",
    bodyTextFormats: createDefaultBodyTextFormats(),
    moreFeatures: createDefaultMoreFeaturesSettings()
  };
}

export const GeneralSettingsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("generalSettings.list"),
    payload: z.object({})
  });

export const GeneralSettingsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("generalSettings.save"),
    payload: GeneralSettingsSchema
  });
