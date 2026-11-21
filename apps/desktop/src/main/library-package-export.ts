import { join } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import {
  ExportLibraryPackageResultSchema,
  LibraryPackageExportSourceSchema,
  buildLibraryPackageFiles,
  type ExportLibraryPackageResult
} from "@deepwrite/contracts";
import { nativeLocale, nativeText } from "./native-i18n";
import {
  availableExportPath,
  writeExportFileAtomically
} from "./export-file-paths";
import { createZip } from "./zip-writer";

export interface LibraryPackageExportOptions {
  window: BrowserWindow;
  dialog: Pick<Dialog, "showOpenDialog">;
  defaultPath: string;
  appVersion: string;
  /** Core's read-only `catalog.readLibraryPackageSource`. */
  readSource(): Promise<unknown>;
}

/**
 * Reads the library or group first, so problems surface before the folder
 * picker; then writes one ZIP of readable Markdown files into the folder.
 */
export async function exportLibraryPackage(
  options: LibraryPackageExportOptions
): Promise<ExportLibraryPackageResult> {
  const source = LibraryPackageExportSourceSchema.parse(
    await options.readSource()
  );
  const selection = await options.dialog.showOpenDialog(options.window, {
    title: nativeText("chooseExportFolder"),
    buttonLabel: nativeText("exportHere"),
    defaultPath: options.defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });
  const folder = selection.filePaths[0];
  if (selection.canceled || !folder) {
    return ExportLibraryPackageResultSchema.parse({ status: "cancelled" });
  }
  const exportedAt = new Date();
  const layout = buildLibraryPackageFiles(source, {
    locale: nativeLocale(),
    generator: `DeepWrite ${options.appVersion}`,
    exportedAt: exportedAt.toISOString()
  });
  const filePath = await availableExportPath(
    join(folder, layout.rootName),
    ".zip"
  );
  await writeExportFileAtomically(
    filePath,
    createZip(
      layout.files.map(({ path, content }) => ({
        name: path,
        data: Buffer.from(content, "utf8")
      })),
      exportedAt
    )
  );
  return ExportLibraryPackageResultSchema.parse({
    status: "saved",
    filePath,
    libraryCount: layout.libraryCount,
    entryCount: layout.entryCount,
    skippedLibraryCount: layout.skippedLibraryCount
  });
}
