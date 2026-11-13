import { nativeImage } from "electron";
import {
  BOOK_IMAGE_EXPORT_MAX_BYTES,
  BOOK_IMAGE_MAX_DIMENSION,
  BookImagesResolveResultSchema,
  parseBookImageLine,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts";
import { bookImageCore, type BookImageCore } from "./core-client";
import { BookImageError } from "./pick";
import { readBookImage } from "./read";

export interface BookImageExportAsset {
  path: string;
  bytes: Buffer;
  ext: "png" | "jpg";
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}
export type BookImageExportLoader = (
  book: ChatAssistantProjectRef,
  sources: readonly string[]
) => Promise<{
  assets: Map<string, BookImageExportAsset>;
  missingImages: number;
}>;
export function createBookImageExportLoader(
  core: BookImageCore
): BookImageExportLoader {
  return async (book, sources) => {
    const counts = new Map<string, number>();
    for (const source of sources)
      for (const line of source.split(/\r\n?|\n/u)) {
        const ref = parseBookImageLine(line);
        if (ref) counts.set(ref.path, (counts.get(ref.path) ?? 0) + 1);
      }
    const assets = new Map<string, BookImageExportAsset>();
    let missingImages = 0;
    let totalBytes = 0;
    for (const [path, count] of counts) {
      let asset: BookImageExportAsset;
      try {
        const resolved = BookImagesResolveResultSchema.parse(
          await bookImageCore(core, "bookImages.resolve", { book, path }, book)
        );
        const bytes = await readBookImage(resolved);
        const image = nativeImage.createFromBuffer(bytes);
        const { width, height } = image.getSize();
        if (
          image.isEmpty() ||
          width <= 0 ||
          height <= 0 ||
          Math.max(width, height) > BOOK_IMAGE_MAX_DIMENSION
        )
          throw new Error("invalid image");
        asset = {
          path,
          bytes,
          ext: resolved.mimeType === "image/png" ? "png" : "jpg",
          mimeType: resolved.mimeType,
          width,
          height
        };
      } catch {
        missingImages += count;
        continue;
      }
      totalBytes += asset.bytes.length;
      if (totalBytes > BOOK_IMAGE_EXPORT_MAX_BYTES)
        throw new BookImageError(
          "book_image.export_too_large",
          "导出图片总量不得超过 512 MB。"
        );
      assets.set(path, asset);
    }
    return { assets, missingImages };
  };
}
