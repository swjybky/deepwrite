import { availableExportPath } from "./export-file-paths";
import { nativeText } from "./native-i18n";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
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
import {
  loadMarkdownImages,
  markdownHeading,
  markdownWithImages,
  writeMarkdownWithAssets
} from "./manuscript-markdown";

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
  const directoryPath = await availableExportPath(
    directoryBase,
    "",
    "导出目录中存在过多同名文件，请更换导出位置。"
  );
  await mkdir(directoryPath, { recursive: false });
  const extension = input.format === "md" ? ".md" : ".txt";

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
      let relativeKey = `${relativeBase}${extension}`;
      while (usedRelativePaths.has(relativeKey)) {
        suffix += 1;
        relativeKey = `${relativeBase} (${suffix})${extension}`;
      }
      usedRelativePaths.add(relativeKey);
      const targetBase = join(
        parentPath,
        suffix === 1 ? filename : `${filename} (${suffix})`
      );
      const content =
        input.format === "md"
          ? markdownWithImages(
              file.content,
              assets,
              `${"../".repeat(directories.length)}images`
            )
          : `\ufeff${textWithImagePlaceholders(file.content, assets, true)}`;
      await writeFile(`${targetBase}${extension}`, content, "utf8");
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

function combinedLongManuscriptMarkdown(
  input: ExportLongManuscriptInput,
  assets: ManuscriptImageAssets,
  assetFolderLink: string
): string {
  const parts = [markdownHeading(1, input.title)];
  let section = "";
  for (const file of input.files) {
    const [nextSection = "", ...labels] = file.path;
    if (nextSection !== section) {
      section = nextSection;
      parts.push(markdownHeading(2, section));
    }
    parts.push(markdownHeading(3, labels.join(" / ")));
    const content = markdownWithImages(file.content, assets, assetFolderLink);
    if (content.trim()) parts.push(content.replace(/\n+$/u, ""));
  }
  return `${parts.join("\n\n")}\n`;
}

export async function exportLongManuscript(
  window: BrowserWindow,
  rawInput: ExportLongManuscriptInput,
  loadImages?: BookImageExportLoader
): Promise<ExportLongManuscriptResult> {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  const isMarkdown = input.format === "md";
  if (input.mode && input.mode !== "folder") {
    const extension = isMarkdown ? "md" : "txt";
    const selection = await dialog.showSaveDialog(window, {
      title: nativeText(isMarkdown ? "exportMarkdown" : "saveLongExport"),
      defaultPath: `${safeLongExportName(input.title, "长篇")}.${extension}`,
      filters: [
        {
          name: isMarkdown ? nativeText("markdownDocument") : "TXT",
          extensions: [extension]
        }
      ],
      ...(isMarkdown
        ? { properties: ["createDirectory", "showOverwriteConfirmation"] }
        : {})
    });
    if (selection.canceled || !selection.filePath) {
      return ExportLongManuscriptResultSchema.parse({ status: "cancelled" });
    }
    if (isMarkdown) {
      const filePath =
        extname(selection.filePath).toLowerCase() === ".md"
          ? selection.filePath
          : `${selection.filePath}.md`;
      const { assets, missingImages } = await loadMarkdownImages(
        input.book,
        input.files.map((file) => file.content),
        loadImages
      );
      await writeMarkdownWithAssets(filePath, assets, (link) =>
        combinedLongManuscriptMarkdown(input, assets, link)
      );
      return ExportLongManuscriptResultSchema.parse({
        status: "saved",
        filePath,
        fileCount: 1,
        missingImages
      });
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
  const loadAssets = isMarkdown ? loadMarkdownImages : loadManuscriptImages;
  const { assets, missingImages } = await loadAssets(
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
