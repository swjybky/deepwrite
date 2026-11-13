import { verifyBookImageHandle } from "./verify-file";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  BOOK_IMAGE_MAX_BYTES,
  type BookImagesResolveResult
} from "@deepwrite/contracts";
import { identifyImage } from "../image/image-download";

export async function readBookImage(
  asset: BookImagesResolveResult
): Promise<Buffer> {
  const handle = await open(
    asset.path,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    await verifyBookImageHandle(asset, handle);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size !== asset.byteSize ||
      stat.size <= 0 ||
      stat.size > BOOK_IMAGE_MAX_BYTES
    )
      throw new Error("图片文件无效。");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (!bytesRead) throw new Error("图片文件已变化。");
      offset += bytesRead;
    }
    await verifyBookImageHandle(asset, handle);
    if (
      (await handle.stat()).size !== stat.size ||
      identifyImage(bytes) !== asset.mimeType
    )
      throw new Error("图片文件已变化。");
    return bytes;
  } finally {
    await handle.close();
  }
}
