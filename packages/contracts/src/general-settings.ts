import { z } from "zod";
import {
  BodyTextFormatsSchema,
  createDefaultBodyTextFormats
} from "./body-text-format";
import { EnvelopeBaseSchema } from "./envelope";

export const GeneralPermissionModeSchema = z.enum([
  "request-approval",
  "auto-approve"
]);
export type GeneralPermissionMode = z.infer<typeof GeneralPermissionModeSchema>;

export const AppLanguageSchema = z.enum(["auto", "zh-CN"]);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;

export const WorkspacePaneLayoutSchema = z.enum([
  "agent-editor",
  "editor-agent"
]);
export type WorkspacePaneLayout = z.infer<typeof WorkspacePaneLayoutSchema>;

export const TextViewModeSchema = z.enum(["edit", "preview"]);
export type TextViewMode = z.infer<typeof TextViewModeSchema>;

export const GeneralSettingsSchema = z.object({
  permissionMode: GeneralPermissionModeSchema,
  autoApproveCrossStageOperations: z.boolean().default(true),
  autoSave: z.boolean(),
  language: AppLanguageSchema,
  showInMenuBar: z.boolean(),
  showContextUsage: z.boolean().default(true),
  // Compaction is per-request and only rewrites the message array sent to the
  // model — see `pi-runtime-adapter/src/context-compression.ts`. The threshold
  // is a percentage of the model's context window; 50 is the floor because
  // compacting earlier than half costs more than it saves.
  autoCompactContext: z.boolean().default(true),
  autoCompactThresholdPercent: z.number().int().min(50).max(95).default(80),
  useNetworkProxy: z.boolean().default(false),
  workspacePaneLayout: WorkspacePaneLayoutSchema.default("agent-editor"),
  defaultTextViewMode: TextViewModeSchema.default("edit"),
  bodyTextFormats: BodyTextFormatsSchema.default(createDefaultBodyTextFormats)
});
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
    showContextUsage: true,
    autoCompactContext: true,
    autoCompactThresholdPercent: 80,
    useNetworkProxy: false,
    workspacePaneLayout: "agent-editor",
    defaultTextViewMode: "edit",
    bodyTextFormats: createDefaultBodyTextFormats()
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
