import { nativeText } from "./native-i18n";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ExportLongManuscriptInputSchema,
  ExportLongManuscriptResultSchema,
  type ExportLongManuscriptInput,
  type ExportLongManuscriptResult
} from "@deepwrite/contracts";

import {
  loadManuscriptImages,
  textWithImagePlaceholders,
  type ManuscriptImageAssets
} from "./manuscript-export-images";
import type { BookImageExportLoader } from "./book-images/export-assets";

const WINDOWS_RESERVED_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function safeLongExportName(label: string, fallback = "未命名"): string {
  const safe = Array.from(
    label
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[. ]+$/gu, "")
  )
    .slice(0, 120)
    .join("");
  if (!safe || WINDOWS_RESERVED_NAMES.test(safe)) return fallback;
  return safe;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function uniquePath(path: string, extension = ""): Promise<string> {
  if (!(await pathExists(`${path}${extension}`))) return `${path}${extension}`;
  for (let index = 2; index < 100_000; index += 1) {
    const candidate = `${path} (${index})${extension}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("导出目录中存在过多同名文件，请更换导出位置。");
}

export async function writeLongManuscriptExport(
  parentDirectory: string,
  rawInput: ExportLongManuscriptInput,
  assets?: ManuscriptImageAssets
): Promise<{ directoryPath: string; fileCount: number }> {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  const directoryBase = join(
    parentDirectory,
    `${safeLongExportName(input.title, "长篇")}-导出`
  );
  const directoryPath = await uniquePath(directoryBase);
  await mkdir(directoryPath, { recursive: false });

  try {
    if (assets?.size) {
      await mkdir(join(directoryPath, "images"));
      for (const [path, asset] of assets) {
        await writeFile(join(directoryPath, path), asset.bytes, { flag: "wx" });
      }
    }
    const usedRelativePaths = new Set<string>();
    for (const file of input.files) {
      const directories = file.path
        .slice(0, -1)
        .map((segment) => safeLongExportName(segment));
      const filename = safeLongExportName(file.path.at(-1) ?? "未命名");
      const parentPath = join(directoryPath, ...directories);
      await mkdir(parentPath, { recursive: true });

      const relativeBase = join(...directories, filename).toLocaleLowerCase();
      let suffix = 1;
      let relativeKey = `${relativeBase}.txt`;
      while (usedRelativePaths.has(relativeKey)) {
        suffix += 1;
        relativeKey = `${relativeBase} (${suffix}).txt`;
      }
      usedRelativePaths.add(relativeKey);
      const targetBase = join(
        parentPath,
        suffix === 1 ? filename : `${filename} (${suffix})`
      );
      await writeFile(
        `${targetBase}.txt`,
        `\ufeff${textWithImagePlaceholders(file.content, assets, true)}`,
        "utf8"
      );
    }

    return { directoryPath, fileCount: input.files.length };
  } catch (error) {
    await rm(directoryPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 20
    });
    throw error;
  }
}

export function combinedLongManuscriptText(
  rawInput: ExportLongManuscriptInput
): string {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  const parts = [input.title];
  let section = "";
  for (const file of input.files) {
    const [nextSection = "", ...labels] = file.path;
    if (nextSection !== section) {
      section = nextSection;
      parts.push(`【${section}】`);
    }
    parts.push(`〔${labels.join(" / ")}〕`);
    const content = textWithImagePlaceholders(file.content);
    if (content.trim()) parts.push(content.trimEnd());
  }
  return `\ufeff${parts.join("\n\n")}\n`;
}

export async function exportLongManuscript(
  window: BrowserWindow,
  rawInput: ExportLongManuscriptInput,
  loadImages?: BookImageExportLoader
): Promise<ExportLongManuscriptResult> {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  if (input.mode === "single-txt") {
    const selection = await dialog.showSaveDialog(window, {
      title: nativeText("saveLongExport"),
      defaultPath: `${safeLongExportName(input.title, "长篇")}.txt`,
      filters: [{ name: "TXT", extensions: ["txt"] }]
    });
    if (selection.canceled || !selection.filePath) {
      return ExportLongManuscriptResultSchema.parse({ status: "cancelled" });
    }
    // A single TXT only writes placeholders and never reads image bytes.
    await writeFile(
      selection.filePath,
      combinedLongManuscriptText(input),
      "utf8"
    );
    return ExportLongManuscriptResultSchema.parse({
      status: "saved",
      filePath: selection.filePath,
      fileCount: 1,
      missingImages: 0
    });
  }
  const selection = await dialog.showOpenDialog(window, {
    title: nativeText("chooseLongExport"),
    buttonLabel: nativeText("exportHere"),
    properties: ["openDirectory", "createDirectory"]
  });
  const parentDirectory = selection.filePaths[0];
  if (selection.canceled || !parentDirectory) {
    return ExportLongManuscriptResultSchema.parse({ status: "cancelled" });
  }
  const { assets, missingImages } = await loadManuscriptImages(
    input.book,
    input.files.map((file) => file.content),
    loadImages
  );
  return ExportLongManuscriptResultSchema.parse({
    status: "saved",
    missingImages,
    ...(await writeLongManuscriptExport(parentDirectory, input, assets))
  });
}
