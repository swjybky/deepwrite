import {
  CatalogLibrarySchema,
  ImportLegacyLibraryResultSchema,
  type ImportLegacyLibraryResult
} from "@deepwrite/contracts";
import type { OpenDialogOptions } from "electron";
import { basename } from "node:path";

export const LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES: NonNullable<
  OpenDialogOptions["properties"]
> = [
  "openFile",
  "multiSelections"
];

export async function importLegacyLibraryArchives(
  archivePaths: string[],
  importArchive: (archivePath: string, index: number) => Promise<unknown>
): Promise<ImportLegacyLibraryResult> {
  const imported: ImportLegacyLibraryResult["imported"] = [];
  const failures: ImportLegacyLibraryResult["failures"] = [];

  for (const [index, archivePath] of archivePaths.entries()) {
    try {
      imported.push(
        CatalogLibrarySchema.parse(await importArchive(archivePath, index))
      );
    } catch (error: unknown) {
      failures.push({
        fileName: basename(archivePath),
        message: error instanceof Error ? error.message : "导入失败。"
      });
    }
  }

  return ImportLegacyLibraryResultSchema.parse({ imported, failures });
}
