import {
  CommandEnvelopeSchema,
  LocalBackupApplyImportInputSchema,
  LocalBackupCancelExportResultSchema,
  LocalBackupDiscardPreviewInputSchema,
  LocalBackupDiscardPreviewResultSchema,
  LocalBackupExportPackageInputSchema,
  LocalBackupExportResultSchema,
  LocalBackupImportPreviewSchema,
  LocalBackupImportResultSchema,
  LocalBackupInventorySnapshotSchema,
  LocalBackupOpenExportFolderInputSchema,
  LocalBackupOpenExportFolderResultSchema,
  LocalBackupSetTestDialogPathsInputSchema,
  createEnvelope,
  type LocalBackupApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

function idOpts() {
  const id = browserId("cmd_local_backup");
  return { id, correlationId: id };
}

/** Renderer -> Main bridge for local cross-computer backup and migration. */
export const localBackup: LocalBackupApi = {
  async getInventory() {
    return LocalBackupInventorySnapshotSchema.parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope("localBackup.getInventory", {}, idOpts())
        )
      )
    );
  },

  async exportPackage(input) {
    return LocalBackupExportResultSchema.nullable().parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "localBackup.exportPackage",
            LocalBackupExportPackageInputSchema.parse(input),
            idOpts()
          )
        )
      )
    );
  },

  async cancelExport() {
    return LocalBackupCancelExportResultSchema.parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope("localBackup.cancelExport", {}, idOpts())
        )
      )
    );
  },

  async openExportFolder(filePath) {
    LocalBackupOpenExportFolderResultSchema.parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "localBackup.openExportFolder",
            LocalBackupOpenExportFolderInputSchema.parse({ filePath }),
            idOpts()
          )
        )
      )
    );
  },

  async chooseImportPackage() {
    return LocalBackupImportPreviewSchema.nullable().parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope("localBackup.chooseImportPackage", {}, idOpts())
        )
      )
    );
  },

  async applyImport(input) {
    return LocalBackupImportResultSchema.parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "localBackup.applyImport",
            LocalBackupApplyImportInputSchema.parse(input),
            idOpts()
          )
        )
      )
    );
  },

  async discardImportPreview(previewId) {
    LocalBackupDiscardPreviewResultSchema.parse(
      await invokeCommand(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "localBackup.discardImportPreview",
            LocalBackupDiscardPreviewInputSchema.parse({ previewId }),
            idOpts()
          )
        )
      )
    );
  },

  async setTestDialogPaths(input) {
    await invokeCommand(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "localBackup.setTestDialogPaths",
          LocalBackupSetTestDialogPathsInputSchema.parse(input),
          idOpts()
        )
      )
    );
  }
};
