import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const CLOUD_BACKUP_IPC_CHANNEL = "deepwrite:cloud-backup" as const;
export const CLOUD_BACKUP_QUOTA_BYTES = 100 * 1024 * 1024;
export const CLOUD_BACKUP_MANIFEST_VERSION = 1 as const;

export const CLOUD_BACKUP_ITEM_KINDS = [
  "book",
  "long-book",
  "material-library",
  "material-group",
  "skill-library",
  "skill-group"
] as const;
export const CloudBackupItemKindSchema = z.enum(CLOUD_BACKUP_ITEM_KINDS);
export type CloudBackupItemKind = z.infer<typeof CloudBackupItemKindSchema>;

export const CLOUD_BACKUP_CHANGE_KINDS = [
  "add",
  "overwrite",
  "keep",
  "drop"
] as const;
export const CloudBackupChangeKindSchema = z.enum(CLOUD_BACKUP_CHANGE_KINDS);
export type CloudBackupChangeKind = z.infer<typeof CloudBackupChangeKindSchema>;

export const CLOUD_BACKUP_DIRECTIONS = ["upload", "download"] as const;
export const CloudBackupDirectionSchema = z.enum(CLOUD_BACKUP_DIRECTIONS);
export type CloudBackupDirection = z.infer<typeof CloudBackupDirectionSchema>;

export const CloudBackupMachineKeySchema = z
  .string()
  .trim()
  .regex(
    /^DW-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/u,
    "备份密钥格式无效。"
  );
export type CloudBackupMachineKey = z.infer<typeof CloudBackupMachineKeySchema>;

export const CloudBackupItemSchema = z
  .object({
    kind: CloudBackupItemKindSchema,
    id: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(256),
    hash: z.string().trim().min(1).max(128),
    sizeBytes: z.number().int().nonnegative()
  })
  .strict();
export type CloudBackupItem = z.infer<typeof CloudBackupItemSchema>;

export const CloudBackupChangeSchema = z
  .object({
    kind: CloudBackupItemKindSchema,
    change: CloudBackupChangeKindSchema,
    id: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(256),
    sizeBytes: z.number().int().nonnegative()
  })
  .strict();
export type CloudBackupChange = z.infer<typeof CloudBackupChangeSchema>;

export const CloudBackupStatusSchema = z
  .object({
    configured: z.boolean(),
    machineKey: CloudBackupMachineKeySchema,
    quotaBytes: z.number().int().positive(),
    usedBytes: z.number().int().nonnegative(),
    localItemCount: z.number().int().nonnegative(),
    remoteItemCount: z.number().int().nonnegative(),
    lastBackupAt: z.string().datetime().nullable()
  })
  .strict();
export type CloudBackupStatus = z.infer<typeof CloudBackupStatusSchema>;

export const CloudBackupPreviewSchema = z
  .object({
    previewId: z.string().trim().min(1).max(128),
    direction: CloudBackupDirectionSchema,
    machineKey: CloudBackupMachineKeySchema,
    remoteUpdatedAt: z.string().datetime().nullable(),
    totalBytes: z.number().int().nonnegative(),
    quotaBytes: z.number().int().positive(),
    changes: z.array(CloudBackupChangeSchema)
  })
  .strict();
export type CloudBackupPreview = z.infer<typeof CloudBackupPreviewSchema>;

export const CloudBackupApplyResultSchema = z
  .object({
    direction: CloudBackupDirectionSchema,
    added: z.number().int().nonnegative(),
    overwritten: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type CloudBackupApplyResult = z.infer<
  typeof CloudBackupApplyResultSchema
>;

export const CloudBackupIpcRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("status") }).strict(),
  z.object({ operation: z.literal("previewBackup") }).strict(),
  z
    .object({
      operation: z.literal("applyBackup"),
      previewId: z.string().trim().min(1).max(128)
    })
    .strict(),
  z
    .object({
      operation: z.literal("previewRestore"),
      machineKey: z.string().trim().min(1).max(64)
    })
    .strict(),
  z
    .object({
      operation: z.literal("applyRestore"),
      previewId: z.string().trim().min(1).max(128)
    })
    .strict()
]);
export type CloudBackupIpcRequest = z.infer<typeof CloudBackupIpcRequestSchema>;

/** A project Core has registered, so Main can pack it without reading Core's registries. */
export const BackupProjectRegistrationSchema = z.object({
  kind: CloudBackupItemKindSchema,
  id: z.string().min(1),
  projectDirectory: z.string().min(1)
});
export type BackupProjectRegistration = z.infer<
  typeof BackupProjectRegistrationSchema
>;

export const ListBackupProjectsResultSchema = z.object({
  projects: z.array(BackupProjectRegistrationSchema)
});

export const CatalogListBackupProjectsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.listBackupProjects"),
    payload: z.object({})
  });
