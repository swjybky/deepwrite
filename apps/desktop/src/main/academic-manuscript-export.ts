import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { dialog, type BrowserWindow, type SaveDialogOptions } from "electron";
import {
  ExportAcademicManuscriptInputSchema,
  ExportAcademicManuscriptResultSchema,
  type AcademicManuscriptExportFormat,
  type ExportAcademicManuscriptInput,
  type ExportAcademicManuscriptResult
} from "@deepwrite/contracts";
import {
  buildAcademicDocx,
  buildAcademicDocxWithReport
} from "./academic-manuscript-docx";
import type { BookImageExportLoader } from "./book-images/export-assets";
import {
  loadManuscriptImages,
  normalizeText,
  parseBookImageLine,
  type ManuscriptImageAssets
} from "./manuscript-export-images";
import { nativeText } from "./native-i18n";
import { safeManuscriptFileName } from "./short-manuscript-export";

export { buildAcademicDocx, buildAcademicDocxWithReport };

function rewriteSectionMarkdownImages(
  content: string,
  assetsFolderName: string | undefined,
  assets: ManuscriptImageAssets | undefined,
  copiedImages: Map<string, Buffer>
): string {
  const lines = normalizeText(content).split("\n");
  const output: string[] = [];
  let inFence: { char: string; length: number } | null = null;

  for (const line of lines) {
    if (inFence) {
      const closeFence = new RegExp(
        `^\\s*${inFence.char}{${inFence.length},}\\s*$`,
        "u"
      );
      if (closeFence.test(line)) inFence = null;
      output.push(line);
      continue;
    }

    const openFence = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (openFence) {
      inFence = { char: openFence[1]![0]!, length: openFence[1]!.length };
      output.push(line);
      continue;
    }

    if (assetsFolderName && assets) {
      const image = parseBookImageLine(line);
      if (image) {
        const loaded = assets.get(image.path);
        if (loaded) {
          const fileName = image.path.slice("images/".length);
          copiedImages.set(fileName, loaded.bytes);
          output.push(`![${image.alt}](./${assetsFolderName}/${fileName})`);
          continue;
        }
      }
    }

    output.push(line);
  }

  return output.join("\n").trim();
}

export function buildAcademicMarkdown(
  input: ExportAcademicManuscriptInput,
  options: {
    assetsFolderName?: string | undefined;
    assets?: ManuscriptImageAssets | undefined;
  } = {}
): { markdown: string; copiedAssets: Map<string, Buffer> } {
  const validated = ExportAcademicManuscriptInputSchema.parse({
    ...input,
    format: "md"
  });
  const imageMode = validated.imageMode ?? "assets_folder";
  const effectiveAssetsFolder =
    imageMode === "assets_folder" ? options.assetsFolderName : undefined;
  const copiedAssets = new Map<string, Buffer>();
  const parts: string[] = [`# ${validated.title}`];
  let lastChapterKey: string | undefined;

  for (const item of validated.items) {
    const hasChapterHeading = Boolean(
      validated.includeChapterHeadings && item.chapterTitle
    );
    if (hasChapterHeading) {
      const chapterKey = item.chapterId ?? `title:${item.chapterTitle}`;
      if (chapterKey !== lastChapterKey) {
        parts.push(`# ${item.chapterTitle}`);
        lastChapterKey = chapterKey;
      }
      parts.push(`## ${item.sectionTitle}`);
    } else {
      lastChapterKey = undefined;
      parts.push(`## ${item.sectionTitle}`);
    }

    const normalizedBody = rewriteSectionMarkdownImages(
      item.content,
      effectiveAssetsFolder,
      options.assets,
      copiedAssets
    );
    if (normalizedBody.length > 0) {
      parts.push(normalizedBody);
    }
  }

  return {
    markdown: `${parts.join("\n\n")}\n`,
    copiedAssets
  };
}

function ensureAcademicFormatExtension(
  filePath: string,
  format: AcademicManuscriptExportFormat
): string {
  const current = extname(filePath).toLowerCase();
  const desired = `.${format}`;
  if (current === desired) return filePath;
  if ([".docx", ".md", ".markdown"].includes(current)) {
    return `${filePath.slice(0, -current.length)}${desired}`;
  }
  return `${filePath}${desired}`;
}

function academicFormatDialog(): Record<
  AcademicManuscriptExportFormat,
  Pick<SaveDialogOptions, "title" | "filters">
> {
  return {
    docx: {
      title: nativeText("exportDocx"),
      filters: [{ name: nativeText("wordDocument"), extensions: ["docx"] }]
    },
    md: {
      title: nativeText("exportMarkdown"),
      filters: [{ name: nativeText("markdownDocument"), extensions: ["md"] }]
    }
  };
}

export async function exportAcademicManuscript(
  window: BrowserWindow,
  rawInput: ExportAcademicManuscriptInput,
  loadImages?: BookImageExportLoader
): Promise<ExportAcademicManuscriptResult> {
  const input = ExportAcademicManuscriptInputSchema.parse(rawInput);
  const defaultBase = safeManuscriptFileName(input.title) || "学术稿件";
  const selection = await dialog.showSaveDialog(window, {
    ...academicFormatDialog()[input.format],
    buttonLabel: nativeText("export"),
    defaultPath: `${defaultBase}.${input.format}`,
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (selection.canceled || !selection.filePath) {
    return ExportAcademicManuscriptResultSchema.parse({ status: "cancelled" });
  }

  const filePath = ensureAcademicFormatExtension(
    selection.filePath,
    input.format
  );

  if (input.format === "docx") {
    const { assets, missingImages } = await loadManuscriptImages(
      input.book,
      input.items.map((item) => item.content),
      loadImages
    );
    await writeFile(filePath, buildAcademicDocx(input, assets));
    return ExportAcademicManuscriptResultSchema.parse({
      status: "saved",
      filePath,
      missingImages
    });
  }

  const imageMode = input.imageMode ?? "assets_folder";
  if (imageMode === "single_file") {
    const { markdown } = buildAcademicMarkdown(input);
    await writeFile(filePath, markdown, "utf8");
    return ExportAcademicManuscriptResultSchema.parse({
      status: "saved",
      filePath,
      missingImages: 0
    });
  }

  const hasImageReferences = input.items.some((item) =>
    normalizeText(item.content)
      .split("\n")
      .some((line) => Boolean(parseBookImageLine(line)))
  );
  const { assets, missingImages } = hasImageReferences
    ? await loadManuscriptImages(
        input.book,
        input.items.map((item) => item.content),
        loadImages
      )
    : { assets: undefined, missingImages: 0 };

  const baseName = basename(filePath, extname(filePath)) || "manuscript";
  const assetsFolderName = `${baseName}.assets`;
  const { markdown, copiedAssets } = buildAcademicMarkdown(input, {
    assetsFolderName,
    assets
  });

  let assetsDirectory: string | undefined;
  if (copiedAssets.size > 0) {
    assetsDirectory = join(dirname(filePath), assetsFolderName);
    await mkdir(assetsDirectory, { recursive: true });
    for (const [fileName, bytes] of copiedAssets) {
      await writeFile(join(assetsDirectory, fileName), bytes);
    }
  }

  await writeFile(filePath, markdown, "utf8");
  return ExportAcademicManuscriptResultSchema.parse({
    status: "saved",
    filePath,
    ...(assetsDirectory ? { assetsDirectory } : {}),
    missingImages
  });
}
