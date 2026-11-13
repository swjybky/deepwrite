import { lstat, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  BOOK_IMAGE_MAX_BYTES,
  type BookImagesResolveResult
} from "@deepwrite/contracts";

/** Recheck the Core-approved canonical path after opening: O_NOFOLLOW protects only the final component. */
export async function verifyBookImageHandle(
  asset: BookImagesResolveResult,
  handle: FileHandle
): Promise<void> {
  const directory = dirname(asset.path);
  const directoryStat = await lstat(directory);
  const fileStat = await lstat(asset.path);
  const openedStat = await handle.stat();
  if (
    basename(directory) !== "images" ||
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (await realpath(directory)) !== resolve(directory) ||
    !fileStat.isFile() ||
    fileStat.isSymbolicLink() ||
    (await realpath(asset.path)) !== resolve(asset.path) ||
    !openedStat.isFile() ||
    openedStat.dev !== fileStat.dev ||
    openedStat.ino !== fileStat.ino ||
    openedStat.size !== asset.byteSize ||
    openedStat.size <= 0 ||
    openedStat.size > BOOK_IMAGE_MAX_BYTES
  )
    throw new Error("图片路径已变化或文件无效。");
}
