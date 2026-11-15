import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { dialog, nativeImage, type BrowserWindow } from "electron";
import {
  BOOK_IMAGE_MAX_BYTES,
  BOOK_IMAGE_MAX_DIMENSION,
  BOOK_IMAGE_MAX_SELECTION,
  BookImagesWriteResultSchema,
  type BookImagesPickInput,
  type BookImagesPickResult,
  type BookImagesWriteInput
} from "@deepwrite/contracts";
import { nativeText } from "../native-i18n";
import { identifyImage, type ImageDecoder } from "../image/image-download";
import { bookImageCore, type BookImageCore } from "./core-client";

import { BookImageError } from "./errors";
import { encodedImageSize } from "./dimensions";
import { decodeWebpToPng, type WebpConverter } from "./webp";
export { BookImageError } from "./errors";

export async function prepareBookImage(
  path: string,
  decoder: ImageDecoder = nativeImage.createFromBuffer,
  convertWebp: WebpConverter = decodeWebpToPng
): Promise<BookImagesWriteInput["images"][number]> {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink())
    throw new BookImageError(
      "book_image.unsupported_format",
      "请选择普通图片文件。"
    );
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    const current = await lstat(path);
    // Windows does not enforce O_NOFOLLOW; verify both the path and opened file.
    if (
      !stat.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== selected.dev ||
      current.ino !== selected.ino ||
      stat.dev !== selected.dev ||
      stat.ino !== selected.ino
    )
      throw new BookImageError(
        "book_image.unsupported_format",
        "图片文件已变化。"
      );
    if (stat.size <= 0 || stat.size > BOOK_IMAGE_MAX_BYTES)
      throw new BookImageError(
        "book_image.too_large",
        "单张图片不得超过 20 MB。"
      );
    bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (!result.bytesRead)
        throw new BookImageError(
          "book_image.unsupported_format",
          "图片文件已变化。"
        );
      offset += result.bytesRead;
    }
    if ((await handle.stat()).size !== stat.size)
      throw new BookImageError("book_image.too_large", "图片文件已变化。");
  } finally {
    await handle.close();
  }
  let mimeType;
  try {
    mimeType = identifyImage(bytes);
  } catch {
    throw new BookImageError(
      "book_image.unsupported_format",
      "请选择 PNG、JPEG 或 WebP 图片。"
    );
  }
  const declared = encodedImageSize(bytes, mimeType);
  if (
    declared &&
    Math.max(declared.width, declared.height) > BOOK_IMAGE_MAX_DIMENSION
  )
    throw new BookImageError(
      "book_image.invalid_dimensions",
      "图片长边不得超过 8192 像素。"
    );
  let image;
  try {
    image = decoder(bytes);
  } catch (error) {
    if (mimeType !== "image/webp") throw error;
  }
  let converted: Buffer | undefined;
  if (mimeType === "image/webp" && (!image || image.isEmpty())) {
    converted = await convertWebp(bytes);
    image = decoder(converted);
  }
  if (!image)
    throw new BookImageError("book_image.invalid_dimensions", "图片无法解码。");
  const { width, height } = image.getSize();
  if (
    image.isEmpty() ||
    width < 1 ||
    height < 1 ||
    Math.max(width, height) > BOOK_IMAGE_MAX_DIMENSION
  )
    throw new BookImageError(
      "book_image.invalid_dimensions",
      "图片无法解码或尺寸无效。"
    );
  const stored =
    mimeType === "image/webp" ? (converted ?? image.toPNG()) : bytes;
  if (stored.length > BOOK_IMAGE_MAX_BYTES)
    throw new BookImageError("book_image.too_large", "图片转换后超过 20 MB。");
  return {
    bytes: stored.toString("base64"),
    ext: mimeType === "image/jpeg" ? "jpg" : "png",
    baseName: basename(path, extname(path)).slice(0, 512)
  };
}

export async function pickBookImages(
  window: BrowserWindow | null,
  input: BookImagesPickInput,
  core: BookImageCore
): Promise<BookImagesPickResult> {
  const options: Electron.OpenDialogOptions = {
    title: nativeText("pickBookImages"),
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: nativeText("bookImageFiles"),
        extensions: ["png", "jpg", "jpeg", "webp"]
      }
    ]
  };
  const selected = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (selected.canceled || !selected.filePaths.length)
    return { status: "cancelled" };
  if (selected.filePaths.length > BOOK_IMAGE_MAX_SELECTION)
    throw new BookImageError(
      "book_image.too_large",
      nativeText("bookImageSelectionLimit")
    );
  const images: BookImagesWriteInput["images"] = [];
  const rejected: Extract<
    BookImagesPickResult,
    { status: "saved" }
  >["rejected"] = [];
  for (const path of selected.filePaths) {
    try {
      images.push(await prepareBookImage(path));
    } catch (error) {
      rejected.push({
        name: basename(path).slice(0, 512),
        code:
          error instanceof BookImageError
            ? error.code
            : "book_image.unsupported_format"
      });
    }
  }
  if (!images.length) return { status: "saved", images: [], rejected };
  const saved = BookImagesWriteResultSchema.parse(
    await bookImageCore(
      core,
      "bookImages.write",
      { ...input, images },
      input.book
    )
  );
  return { status: "saved", images: saved.images, rejected };
}
