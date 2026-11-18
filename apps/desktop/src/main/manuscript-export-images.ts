import {
  parseBookImageLine,
  type BookImageBookRef
} from "@deepwrite/contracts";
import type {
  BookImageExportAsset,
  BookImageExportLoader
} from "./book-images/export-assets";

export type ManuscriptImageAssets = ReadonlyMap<string, BookImageExportAsset>;

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export { parseBookImageLine };

export function imagePlaceholder(alt: string): string {
  return alt ? `[图片：${alt}]` : "[图片]";
}

export function textWithImagePlaceholders(
  source: string,
  assets?: ManuscriptImageAssets,
  linkImages = false
): string {
  return normalizeText(source)
    .split("\n")
    .map((line) => {
      const image = parseBookImageLine(line);
      if (!image) return line;
      if (assets && !assets.has(image.path)) return "";
      return `${imagePlaceholder(image.alt)}${linkImages ? `(${image.path})` : ""}`;
    })
    .join("\n");
}

export async function loadManuscriptImages(
  book: BookImageBookRef,
  sources: readonly string[],
  loader?: BookImageExportLoader
): Promise<{
  assets: Map<string, BookImageExportAsset>;
  missingImages: number;
}> {
  if (loader) return loader(book, sources);
  return {
    assets: new Map(),
    missingImages: sources.reduce(
      (count, source) =>
        count +
        normalizeText(source)
          .split("\n")
          .filter((line) => parseBookImageLine(line)).length,
      0
    )
  };
}
