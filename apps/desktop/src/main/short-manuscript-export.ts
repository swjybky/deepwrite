import { nativeText } from "./native-i18n";
import { writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { dialog, type BrowserWindow, type SaveDialogOptions } from "electron";
import {
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type ShortManuscriptExportFormat
} from "@deepwrite/contracts";
import { buildDocx } from "./short-manuscript-docx";
import { buildEpub } from "./short-manuscript-epub";
import {
  textWithImagePlaceholders,
  loadManuscriptImages,
  type ManuscriptImageAssets
} from "./manuscript-export-images";
import type { BookImageExportLoader } from "./book-images/export-assets";

export { buildDocx, buildEpub };

export function buildTxt(input: ExportShortManuscriptInput): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse({
    ...input,
    format: "txt"
  });
  const content = [
    `《${validated.title}》`,
    ...validated.sections.flatMap((section) => [
      section.title,
      textWithImagePlaceholders(section.content).trim()
    ])
  ].join("\n\n");
  return Buffer.from(`\ufeff${content}\n`, "utf8");
}

export function buildShortManuscriptFile(
  input: ExportShortManuscriptInput,
  assets?: ManuscriptImageAssets
): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse(input);
  if (validated.format === "docx") return buildDocx(validated, assets);
  if (validated.format === "epub") return buildEpub(validated, assets);
  return buildTxt(validated);
}

export function safeManuscriptFileName(title: string): string {
  const safe = Array.from(
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[. ]+$/gu, "")
  )
    .slice(0, 80)
    .join("");
  return safe || "短篇正文";
}

function ensureFormatExtension(
  filePath: string,
  format: ShortManuscriptExportFormat
): string {
  const current = extname(filePath).toLowerCase();
  const desired = `.${format}`;
  if (current === desired) return filePath;
  if ([".docx", ".txt", ".epub"].includes(current)) {
    return `${filePath.slice(0, -current.length)}${desired}`;
  }
  return `${filePath}${desired}`;
}

function formatDialog(): Record<
  ShortManuscriptExportFormat,
  Pick<SaveDialogOptions, "title" | "filters">
> {
  return {
    docx: {
      title: nativeText("exportDocx"),
      filters: [{ name: nativeText("wordDocument"), extensions: ["docx"] }]
    },
    txt: {
      title: nativeText("exportTxt"),
      filters: [{ name: nativeText("textDocument"), extensions: ["txt"] }]
    },
    epub: {
      title: nativeText("exportEpub"),
      filters: [{ name: nativeText("epubBook"), extensions: ["epub"] }]
    }
  };
}

export async function exportShortManuscript(
  window: BrowserWindow,
  rawInput: ExportShortManuscriptInput,
  loadImages?: BookImageExportLoader
): Promise<ExportShortManuscriptResult> {
  const input = ExportShortManuscriptInputSchema.parse(rawInput);
  const selection = await dialog.showSaveDialog(window, {
    ...formatDialog()[input.format],
    buttonLabel: nativeText("export"),
    defaultPath: `${safeManuscriptFileName(input.title)}-正文.${input.format}`,
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (selection.canceled || !selection.filePath) {
    return ExportShortManuscriptResultSchema.parse({ status: "cancelled" });
  }
  const filePath = ensureFormatExtension(selection.filePath, input.format);
  // TXT only writes placeholders, so it never reads or limits image bytes.
  const { assets, missingImages } =
    input.format === "txt"
      ? { assets: undefined, missingImages: 0 }
      : await loadManuscriptImages(
          input.book,
          input.sections.map((section) => section.content),
          loadImages
        );
  await writeFile(filePath, buildShortManuscriptFile(input, assets));
  return ExportShortManuscriptResultSchema.parse({
    status: "saved",
    filePath,
    missingImages
  });
}
