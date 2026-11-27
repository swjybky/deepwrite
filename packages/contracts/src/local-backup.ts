import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { CreativePlotStagesSchema } from "./catalog/plot-stages";
import { LibraryOrganizationSchema } from "./library-organization";

export const LOCAL_BACKUP_FORMAT_VERSION = 1 as const;
export const LOCAL_BACKUP_MIN_APP_VERSION = "1.9.0" as const;
export const LOCAL_BACKUP_FILE_EXTENSION = ".dwbackup.zip" as const;
export const LOCAL_BACKUP_MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
export const LOCAL_BACKUP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const LOCAL_BACKUP_MAX_ENTRIES = 65_534;

export const LocalBackupItemKindSchema = z.enum([
  "book",
  "long-book",
  "mystery-book",
  "material-library",
  "material-group",
  "skill-library",
  "skill-group"
]);
export type LocalBackupItemKind = z.infer<typeof LocalBackupItemKindSchema>;

export const LocalBackupWorkSubtypeSchema = z.enum([
  "short",
  "script",
  "long",
  "academic",
  "mystery"
]);
export type LocalBackupWorkSubtype = z.infer<
  typeof LocalBackupWorkSubtypeSchema
>;

export const LocalBackupConflictPolicySchema = z.enum(["keep_both", "replace"]);
export type LocalBackupConflictPolicy = z.infer<
  typeof LocalBackupConflictPolicySchema
>;

export const LocalBackupPlatformSchema = z.enum(["darwin", "win32", "linux"]);
export type LocalBackupPlatform = z.infer<typeof LocalBackupPlatformSchema>;

export const LocalBackupErrorCodeSchema = z.enum([
  "local_backup.busy",
  "local_backup.workspace_required",
  "local_backup.insufficient_space",
  "local_backup.inconsistent_project",
  "local_backup.invalid_archive",
  "local_backup.checksum_mismatch",
  "local_backup.unsupported_format_version",
  "local_backup.preview_expired",
  "local_backup.target_changed",
  "local_backup.switch_failed",
  "local_backup.canceled",
  "local_backup.test_only",
  "local_backup.operation_failed"
]);
export type LocalBackupErrorCode = z.infer<typeof LocalBackupErrorCodeSchema>;

export const LocalBackupInventoryItemSchema = z
  .object({
    key: z.string().min(1).max(600),
    kind: LocalBackupItemKindSchema,
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(256),
    workSubtype: LocalBackupWorkSubtypeSchema.optional(),
    sizeBytes: z.number().int().nonnegative(),
    empty: z.boolean(),
    isUnbound: z.boolean().optional(),
    linkedMaterialIds: z.array(z.string().min(1)),
    linkedSkillIds: z.array(z.string().min(1)),
    memberIds: z.array(z.string().min(1)).optional()
  })
  .strict();
export type LocalBackupInventoryItem = z.infer<
  typeof LocalBackupInventoryItemSchema
>;

export const LocalBackupInventorySnapshotSchema = z
  .object({
    counts: z
      .object({
        works: z.number().int().nonnegative(),
        materials: z.number().int().nonnegative(),
        skills: z.number().int().nonnegative()
      })
      .strict(),
    items: z.array(LocalBackupInventoryItemSchema)
  })
  .strict();
export type LocalBackupInventorySnapshot = z.infer<
  typeof LocalBackupInventorySnapshotSchema
>;

export const LocalBackupManifestItemSchema = z
  .object({
    kind: LocalBackupItemKindSchema,
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(256),
    workSubtype: LocalBackupWorkSubtypeSchema.optional(),
    isUnbound: z.boolean().optional(),
    sizeBytes: z.number().int().nonnegative(),
    hash: z.string().regex(/^[0-9a-f]{64}$/u)
  })
  .strict();
export type LocalBackupManifestItem = z.infer<
  typeof LocalBackupManifestItemSchema
>;

export const LocalBackupManifestSchema = z
  .object({
    formatVersion: z.literal(LOCAL_BACKUP_FORMAT_VERSION),
    minAppVersion: z.string().min(1).max(64),
    appVersion: z.string().min(1).max(64),
    exportedAt: z.string().datetime(),
    platform: LocalBackupPlatformSchema,
    creativePlotStages: CreativePlotStagesSchema,
    libraryOrganization: LibraryOrganizationSchema.optional(),
    items: z.array(LocalBackupManifestItemSchema),
    sha256ByPath: z.record(
      z.string().min(1),
      z.string().regex(/^[0-9a-f]{64}$/u)
    )
  })
  .strict();
export type LocalBackupManifest = z.infer<typeof LocalBackupManifestSchema>;

export const LocalBackupPreviewStatusSchema = z.enum([
  "new",
  "conflict_same_id",
  "identical",
  "builtin_skipped"
]);
export type LocalBackupPreviewStatus = z.infer<
  typeof LocalBackupPreviewStatusSchema
>;

export const LocalBackupPreviewItemSchema = z
  .object({
    key: z.string().min(1).max(600),
    kind: LocalBackupItemKindSchema,
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(256),
    workSubtype: LocalBackupWorkSubtypeSchema.optional(),
    isUnbound: z.boolean().optional(),
    sizeBytes: z.number().int().nonnegative(),
    status: LocalBackupPreviewStatusSchema,
    hasTitleCollision: z.boolean().optional()
  })
  .strict();
export type LocalBackupPreviewItem = z.infer<
  typeof LocalBackupPreviewItemSchema
>;

export const LocalBackupImportPreviewSummarySchema = z
  .object({
    fileName: z.string().min(1),
    sourcePlatform: LocalBackupPlatformSchema,
    exportedAt: z.string().datetime(),
    appVersion: z.string().min(1),
    totalItems: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    availableDiskBytes: z.number().int().nonnegative(),
    requiredDiskBytes: z.number().int().nonnegative(),
    diskSpaceSufficient: z.boolean(),
    items: z.array(LocalBackupPreviewItemSchema)
  })
  .strict();
export type LocalBackupImportPreviewSummary = z.infer<
  typeof LocalBackupImportPreviewSummarySchema
>;

export const LocalBackupImportPreviewSchema =
  LocalBackupImportPreviewSummarySchema.extend({
    previewId: z.string().min(1),
    expiresAt: z.string().datetime()
  }).strict();
export type LocalBackupImportPreview = z.infer<
  typeof LocalBackupImportPreviewSchema
>;

export const LocalBackupCorePreviewResultSchema = z
  .object({
    preview: LocalBackupImportPreviewSummarySchema,
    localHashes: z.record(z.string().min(1), z.string())
  })
  .strict();
export type LocalBackupCorePreviewResult = z.infer<
  typeof LocalBackupCorePreviewResultSchema
>;

export const LocalBackupExportPackageInputSchema = z
  .object({
    selectedKeys: z.array(z.string().min(1).max(600)).min(1).max(10_000)
  })
  .strict();
export type LocalBackupExportPackageInput = z.infer<
  typeof LocalBackupExportPackageInputSchema
>;

export const LocalBackupExportResultSchema = z
  .object({
    filePath: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    archiveBytes: z.number().int().nonnegative()
  })
  .strict();
export type LocalBackupExportResult = z.infer<
  typeof LocalBackupExportResultSchema
>;

export const LocalBackupOpenExportFolderInputSchema = z
  .object({
    filePath: z.string().min(1)
  })
  .strict();
export type LocalBackupOpenExportFolderInput = z.infer<
  typeof LocalBackupOpenExportFolderInputSchema
>;

export const LocalBackupOpenExportFolderResultSchema = z
  .object({
    opened: z.literal(true)
  })
  .strict();

export const LocalBackupCancelExportResultSchema = z
  .object({
    canceled: z.boolean()
  })
  .strict();
export type LocalBackupCancelExportResult = z.infer<
  typeof LocalBackupCancelExportResultSchema
>;

export const LocalBackupApplyImportInputSchema = z
  .object({
    previewId: z.string().min(1),
    selectedKeys: z.array(z.string().min(1).max(600)).max(10_000),
    conflictPolicy: LocalBackupConflictPolicySchema,
    confirmReplace: z.boolean().optional()
  })
  .strict();
export type LocalBackupApplyImportInput = z.infer<
  typeof LocalBackupApplyImportInputSchema
>;

export const LocalBackupImportResultSchema = z
  .object({
    added: z.number().int().nonnegative(),
    duplicated: z.number().int().nonnegative(),
    replaced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    danglingBindingsRemoved: z.number().int().nonnegative(),
    warnings: z.array(z.string())
  })
  .strict();
export type LocalBackupImportResult = z.infer<
  typeof LocalBackupImportResultSchema
>;

export const LocalBackupDiscardPreviewInputSchema = z
  .object({
    previewId: z.string().min(1)
  })
  .strict();
export type LocalBackupDiscardPreviewInput = z.infer<
  typeof LocalBackupDiscardPreviewInputSchema
>;

export const LocalBackupDiscardPreviewResultSchema = z
  .object({
    discarded: z.boolean()
  })
  .strict();

export const LocalBackupSetTestDialogPathsInputSchema = z
  .object({
    savePath: z.string().min(1).nullable().optional(),
    openPath: z.string().min(1).nullable().optional()
  })
  .strict();
export type LocalBackupSetTestDialogPathsInput = z.infer<
  typeof LocalBackupSetTestDialogPathsInputSchema
>;

export const LocalBackupCoreExportAtPathInputSchema = z
  .object({
    exportId: z.string().min(1),
    targetPath: z.string().min(1),
    selectedKeys: z.array(z.string().min(1).max(600)).min(1).max(10_000),
    appVersion: z.string().min(1),
    platform: LocalBackupPlatformSchema
  })
  .strict();
export type LocalBackupCoreExportAtPathInput = z.infer<
  typeof LocalBackupCoreExportAtPathInputSchema
>;

export const LocalBackupCoreCancelExportInputSchema = z
  .object({
    exportId: z.string().min(1)
  })
  .strict();

export const LocalBackupCorePreviewImportAtPathInputSchema = z
  .object({
    archivePath: z.string().min(1),
    workspaceDirectory: z.string().min(1)
  })
  .strict();

export const LocalBackupCoreApplyImportAtPathInputSchema = z
  .object({
    archivePath: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    selectedKeys: z.array(z.string().min(1).max(600)).max(10_000),
    conflictPolicy: LocalBackupConflictPolicySchema,
    expectedLocalHashes: z.record(z.string().min(1), z.string())
  })
  .strict();
export type LocalBackupCoreApplyImportAtPathInput = z.infer<
  typeof LocalBackupCoreApplyImportAtPathInputSchema
>;

export const LocalBackupGetInventoryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.getInventory"),
    payload: z.object({}).strict()
  });

export const LocalBackupExportPackageCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.exportPackage"),
    payload: LocalBackupExportPackageInputSchema
  });

export const LocalBackupCancelExportCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.cancelExport"),
    payload: z.object({}).strict()
  });

export const LocalBackupOpenExportFolderCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.openExportFolder"),
    payload: LocalBackupOpenExportFolderInputSchema
  });

export const LocalBackupChooseImportPackageCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.chooseImportPackage"),
    payload: z.object({}).strict()
  });

export const LocalBackupApplyImportCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.applyImport"),
    payload: LocalBackupApplyImportInputSchema
  });

export const LocalBackupDiscardImportPreviewCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.discardImportPreview"),
    payload: LocalBackupDiscardPreviewInputSchema
  });

export const LocalBackupSetTestDialogPathsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.setTestDialogPaths"),
    payload: LocalBackupSetTestDialogPathsInputSchema
  });

export const LocalBackupCoreInventoryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.coreInventory"),
    payload: z.object({}).strict()
  });

export const LocalBackupCoreExportAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.coreExportAtPath"),
    payload: LocalBackupCoreExportAtPathInputSchema
  });

export const LocalBackupCoreCancelExportCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.coreCancelExport"),
    payload: LocalBackupCoreCancelExportInputSchema
  });

export const LocalBackupCorePreviewImportAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.corePreviewImportAtPath"),
    payload: LocalBackupCorePreviewImportAtPathInputSchema
  });

export const LocalBackupCoreApplyImportAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("localBackup.coreApplyImportAtPath"),
    payload: LocalBackupCoreApplyImportAtPathInputSchema
  });

export const LocalBackupCommandSchemas = [
  LocalBackupGetInventoryCommandEnvelopeSchema,
  LocalBackupExportPackageCommandEnvelopeSchema,
  LocalBackupCancelExportCommandEnvelopeSchema,
  LocalBackupOpenExportFolderCommandEnvelopeSchema,
  LocalBackupChooseImportPackageCommandEnvelopeSchema,
  LocalBackupApplyImportCommandEnvelopeSchema,
  LocalBackupDiscardImportPreviewCommandEnvelopeSchema,
  LocalBackupSetTestDialogPathsCommandEnvelopeSchema,
  LocalBackupCoreInventoryCommandEnvelopeSchema,
  LocalBackupCoreExportAtPathCommandEnvelopeSchema,
  LocalBackupCoreCancelExportCommandEnvelopeSchema,
  LocalBackupCorePreviewImportAtPathCommandEnvelopeSchema,
  LocalBackupCoreApplyImportAtPathCommandEnvelopeSchema
] as const;

export interface LocalBackupApi {
  getInventory(): Promise<LocalBackupInventorySnapshot>;
  exportPackage(
    input: LocalBackupExportPackageInput
  ): Promise<LocalBackupExportResult | null>;
  cancelExport(): Promise<LocalBackupCancelExportResult>;
  openExportFolder(filePath: string): Promise<void>;
  chooseImportPackage(): Promise<LocalBackupImportPreview | null>;
  applyImport(
    input: LocalBackupApplyImportInput
  ): Promise<LocalBackupImportResult>;
  discardImportPreview(previewId: string): Promise<void>;
  setTestDialogPaths?(input: LocalBackupSetTestDialogPathsInput): Promise<void>;
}
