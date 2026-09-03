import { z } from "zod";
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
  autoApproveCrossStageOperations: z.boolean().default(false),
  autoSave: z.boolean(),
  language: AppLanguageSchema,
  showInMenuBar: z.boolean(),
  showContextUsage: z.boolean().default(true),
  useNetworkProxy: z.boolean().default(false),
  workspacePaneLayout: WorkspacePaneLayoutSchema.default("agent-editor"),
  defaultTextViewMode: TextViewModeSchema.default("edit")
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
    autoApproveCrossStageOperations: false,
    autoSave: true,
    language: "auto",
    showInMenuBar: true,
    showContextUsage: true,
    useNetworkProxy: false,
    workspacePaneLayout: "agent-editor",
    defaultTextViewMode: "edit"
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
