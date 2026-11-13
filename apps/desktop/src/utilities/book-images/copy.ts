import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  BOOK_IMAGE_MAX_BYTES,
  BookImagePathSchema
} from "@deepwrite/contracts";

/** Copies into an unpublished project; its caller owns rollback of the stage. */
export async function copyBookImages(
  sourceRoot: string,
  targetRoot: string
): Promise<void> {
  const source = join(sourceRoot, "images");
  let directory;
  try {
    directory = await lstat(source);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error("作品 images 必须是真实文件夹。");
  }
  const actualSource = await realpath(source);
  if (actualSource !== join(await realpath(sourceRoot), "images")) {
    throw new Error("图片目录超出作品目录。");
  }
  const target = join(targetRoot, "images");
  await mkdir(target, { mode: 0o700 });
  for (const name of await readdir(actualSource)) {
    if (!BookImagePathSchema.safeParse(`images/${name}`).success) continue;
    const file = join(actualSource, name);
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) continue;
    const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await input.stat();
      const currentDirectory = await lstat(source);
      const currentFile = await lstat(file);
      if (
        currentDirectory.isSymbolicLink() ||
        !currentDirectory.isDirectory() ||
        currentDirectory.dev !== directory.dev ||
        currentDirectory.ino !== directory.ino ||
        (await realpath(source)) !== actualSource ||
        currentFile.isSymbolicLink() ||
        currentFile.dev !== opened.dev ||
        currentFile.ino !== opened.ino
      ) {
        throw new Error("复制期间图片路径已变化。");
      }
      if (
        !opened.isFile() ||
        opened.size === 0 ||
        opened.size > BOOK_IMAGE_MAX_BYTES
      ) {
        throw new Error("复制图片大小无效。");
      }
      if ((await realpath(file)) !== resolve(actualSource, name)) {
        throw new Error("图片路径超出作品目录。");
      }
      const bytes = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await input.read(
          bytes,
          length,
          bytes.length - length,
          null
        );
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length !== opened.size) throw new Error("复制期间图片已变化。");
      const output = await open(join(target, name), "wx", 0o600);
      try {
        await output.writeFile(bytes.subarray(0, length));
        await output.sync();
      } finally {
        await output.close();
      }
    } finally {
      await input.close();
    }
  }
}
