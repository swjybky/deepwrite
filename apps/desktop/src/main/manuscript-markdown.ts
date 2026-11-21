import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type {
  BookImageBookRef,
  BookImageReference
} from "@deepwrite/contracts";
import type { BookImageExportLoader } from "./book-images/export-assets";
import {
  imagePlaceholder,
  loadManuscriptImages,
  normalizeText,
  parseBookImageLine,
  type ManuscriptImageAssets
} from "./manuscript-export-images";

export function markdownHeading(level: number, title: string): string {
  const label = title
    .replace(/\s+/gu, " ")
    .replace(/[\\`*_{}[\]<>#&$~]/gu, "\\$&");
  return `${"#".repeat(level)} ${label}`;
}

function forEachMarkdownImage(
  lines: readonly string[],
  visit: (image: BookImageReference, index: number) => void
): void {
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker?.[1]?.startsWith(fence) && !marker[2]?.trim()) {
        fence = undefined;
      }
      continue;
    }
    if (marker && (marker[1]![0] === "~" || !marker[2]!.includes("`"))) {
      fence = marker[1];
      continue;
    }
    if (/^(?: {4}| {0,3}\t)/u.test(line)) continue;
    const image = parseBookImageLine(line);
    if (image) visit(image, index);
  }
}

export function loadMarkdownImages(
  book: BookImageBookRef,
  sources: readonly string[],
  loader?: BookImageExportLoader
): ReturnType<typeof loadManuscriptImages> {
  const references: string[] = [];
  for (const source of sources) {
    const lines = normalizeText(source).split("\n");
    forEachMarkdownImage(lines, (_, index) => references.push(lines[index]!));
  }
  return loadManuscriptImages(book, references, loader);
}

function encodeLinkSegment(segment: string): string {
  return encodeURIComponent(segment)
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

export function markdownWithImages(
  source: string,
  assets: ManuscriptImageAssets | undefined,
  assetFolderLink: string
): string {
  const lines = normalizeText(source).split("\n");
  forEachMarkdownImage(lines, ({ path, alt }, index) => {
    lines[index] = assets?.has(path)
      ? `![${alt}](${assetFolderLink}/${encodeLinkSegment(basename(path))})`
      : imagePlaceholder(alt);
  });
  return lines.join("\n");
}

async function createAssetsDirectory(filePath: string): Promise<string> {
  const parent = dirname(filePath);
  const stem = basename(filePath, extname(filePath));
  let index = 1;
  while (true) {
    const name = index === 1 ? `${stem}.assets` : `${stem} (${index}).assets`;
    const directory = join(parent, name);
    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      index += 1;
    }
  }
}

export async function writeMarkdownWithAssets(
  filePath: string,
  assets: ManuscriptImageAssets,
  build: (assetFolderLink: string) => string
): Promise<void> {
  const stagePath = join(dirname(filePath), `.deepwrite-${randomUUID()}.tmp`);
  const assetsDirectory = assets.size
    ? await createAssetsDirectory(filePath)
    : undefined;
  try {
    if (assetsDirectory) {
      for (const [path, asset] of assets) {
        await writeFile(join(assetsDirectory, basename(path)), asset.bytes, {
          flag: "wx"
        });
      }
    }
    const link = assetsDirectory
      ? `./${encodeLinkSegment(basename(assetsDirectory))}`
      : "";
    await writeFile(stagePath, build(link), { encoding: "utf8", flag: "wx" });
    await rename(stagePath, filePath);
  } catch (error) {
    await rm(stagePath, { force: true }).catch(() => undefined);
    if (assetsDirectory) {
      await rm(assetsDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 20
      }).catch(() => undefined);
    }
    throw error;
  }
}
