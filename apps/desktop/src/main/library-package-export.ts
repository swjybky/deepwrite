import { access, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import {
  ExportLibraryPackageResultSchema,
  LibraryPackageExportSourceSchema,
  buildLibraryPackageFiles,
  type ExportLibraryPackageResult
} from "@deepwrite/contracts";
import { nativeLocale, nativeText } from "./native-i18n";
import { createZip } from "./zip-writer";

export interface LibraryPackageExportOptions {
  window: BrowserWindow;
  dialog: Pick<Dialog, "showOpenDialog">;
  defaultPath: string;
  appVersion: string;
  /** Core's read-only `catalog.readLibraryPackageSource`. */
  readSource(): Promise<unknown>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** "名称.zip", then "名称 (2).zip"…; an existing file is never replaced. */
export async function availableArchivePath(
  folder: string,
  name: string
): Promise<string> {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(
      folder,
      suffix === 1 ? `${name}.zip` : `${name} (${suffix}).zip`
    );
    if (!(await exists(candidate))) return candidate;
  }
}

/** Writes through `.part` so a failed export never leaves a broken ZIP. */
export async function writeArchive(path: string, data: Buffer): Promise<void> {
  const partial = `${path}.part`;
  try {
    await writeFile(partial, data);
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
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
  const filePath = await availableArchivePath(folder, layout.rootName);
  await writeArchive(
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
