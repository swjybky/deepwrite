import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import type { WorkspaceDirectorySettings } from "./workspace-directory";

export const StorageLocationSchema = z
  .object({
    path: z.string().min(1),
    defaultPath: z.string().min(1),
    isDefault: z.boolean()
  })
  .strict();
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const ConversationCompactionPhaseSchema = z.enum([
  "idle",
  "skipped_new",
  "needed",
  "running",
  "verifying",
  "swapping",
  "completed_with_backup",
  "backup_released",
  "failed",
  "rolled_back"
]);
export type ConversationCompactionPhase = z.infer<
  typeof ConversationCompactionPhaseSchema
>;

export const ConversationCompactionFailureCodeSchema = z.enum([
  "none",
  "disk_full",
  "database_locked",
  "old_process_active",
  "integrity_check_failed",
  "logic_check_failed",
  "swap_failed",
  "backup_missing",
  "post_backup_changes_present",
  "unknown"
]);
export type ConversationCompactionFailureCode = z.infer<
  typeof ConversationCompactionFailureCodeSchema
>;

export const ConversationCompactionStatusSchema = z
  .object({
    phase: ConversationCompactionPhaseSchema,
    legacyCallsFound: z.number().int().nonnegative(),
    estimatedReclaimableBytes: z.number().int().nonnegative(),
    processedSessions: z.number().int().nonnegative(),
    totalSessions: z.number().int().nonnegative(),
    bytesBefore: z.number().int().nonnegative(),
    bytesAfter: z.number().int().nonnegative().optional(),
    backupBytes: z.number().int().nonnegative().optional(),
    netFreedBytes: z.number().int().optional(),
    requiredDiskBytes: z.number().int().nonnegative().optional(),
    availableDiskBytes: z.number().int().nonnegative().optional(),
    canRetry: z.boolean(),
    canReleaseBackup: z.boolean(),
    canRollback: z.boolean(),
    failureCode: ConversationCompactionFailureCodeSchema.optional(),
    failureDetail: z.string().optional(),
    startedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    completedAt: z.string().optional(),
    backupPath: z.string().optional()
  })
  .strict();
export type ConversationCompactionStatus = z.infer<
  typeof ConversationCompactionStatusSchema
>;

export const StorageSettingsSnapshotSchema = z
  .object({
    userData: StorageLocationSchema,
    workspace: StorageLocationSchema,
    conversationCompaction: ConversationCompactionStatusSchema.optional()
  })
  .strict();
export type StorageSettingsSnapshot = z.infer<
  typeof StorageSettingsSnapshotSchema
>;

export const StorageDirectoryKindSchema = z.enum(["user-data", "workspace"]);
export type StorageDirectoryKind = z.infer<typeof StorageDirectoryKindSchema>;

export const StorageChangeResultSchema = z
  .object({ restarting: z.boolean() })
  .strict();
export type StorageChangeResult = z.infer<typeof StorageChangeResultSchema>;

/** Stable reasons Main reports for rejected storage changes; Renderer translates by code. */
export const StorageSettingsErrorCodeSchema = z.enum([
  "storage_settings.busy",
  "storage_settings.invalid_directory",
  "storage_settings.unresolvable_path",
  "storage_settings.overlaps_installation",
  "storage_settings.nested_location",
  "storage_settings.target_not_empty",
  "storage_settings.not_writable",
  "storage_settings.save_failed",
  "storage_settings.open_failed"
]);
export type StorageSettingsErrorCode = z.infer<
  typeof StorageSettingsErrorCodeSchema
>;

export const StorageOpenDirectoryInputSchema = z
  .object({ kind: StorageDirectoryKindSchema })
  .strict();
export const StorageOpenDirectoryResultSchema = z
  .object({ opened: z.literal(true) })
  .strict();

export const StorageSettingsGetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.get"),
    payload: z.object({}).strict()
  });

export const StorageSettingsChooseUserDataCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.chooseUserData"),
    payload: z.object({}).strict()
  });

export const StorageSettingsResetUserDataCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.resetUserData"),
    payload: z.object({}).strict()
  });

export const StorageSettingsResetWorkspaceDirectoryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.resetWorkspaceDirectory"),
    payload: z.object({}).strict()
  });

export const StorageSettingsOpenDirectoryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.openDirectory"),
    payload: StorageOpenDirectoryInputSchema
  });

export const StorageSettingsCompactConversationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.compactConversations"),
    payload: z.object({}).strict()
  });

export const StorageSettingsReleaseConversationBackupCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("storageSettings.releaseConversationBackup"),
    payload: z.object({}).strict()
  });

export const StorageSettingsCommandSchemas = [
  StorageSettingsGetCommandEnvelopeSchema,
  StorageSettingsChooseUserDataCommandEnvelopeSchema,
  StorageSettingsResetUserDataCommandEnvelopeSchema,
  StorageSettingsResetWorkspaceDirectoryCommandEnvelopeSchema,
  StorageSettingsOpenDirectoryCommandEnvelopeSchema,
  StorageSettingsCompactConversationsCommandEnvelopeSchema,
  StorageSettingsReleaseConversationBackupCommandEnvelopeSchema
] as const;

export interface StorageSettingsApi {
  get(): Promise<StorageSettingsSnapshot>;
  chooseUserData(): Promise<StorageChangeResult>;
  resetUserData(): Promise<StorageChangeResult>;
  resetWorkspaceDirectory(): Promise<WorkspaceDirectorySettings>;
  openDirectory(kind: StorageDirectoryKind): Promise<void>;
  compactConversations(): Promise<ConversationCompactionStatus>;
  releaseConversationBackup(): Promise<ConversationCompactionStatus>;
}
