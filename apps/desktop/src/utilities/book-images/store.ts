import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  BOOK_IMAGE_MAX_BYTES,
  BookImagePathSchema,
  BookImagesWriteInputSchema,
  type BookImageBookRef,
  type BookImagesWriteInput,
  type BookImagesResolveResult,
  type BookImageReference
} from "@deepwrite/contracts";

export async function assertImageDirectory(
  project: string,
  create = false
): Promise<string> {
  const projectStat = await lstat(resolve(project));
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink())
    throw new Error("作品文件夹必须是普通目录。");
  // Ancestors may be links, junctions or substituted drives; only the book
  // folder itself and its images subtree must be real.
  const directory = join(await realpath(resolve(project)), "images");
  if (create)
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(directory)) !== resolve(directory)
  )
    throw new Error("图片文件夹必须是作品内的普通目录。");
  return directory;
}

export function sanitizeBookImageBaseName(value: string): string {
  // The Markdown reference grammar also excludes spaces and closing parentheses.
  return (
    Array.from(
      value
        .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\s)\]]/gu, "-")
        .replace(/\.{2,}/gu, "-")
        .replace(/^[ .-]+|[ .-]+$/gu, "")
    )
      .slice(0, 40)
      .join("") || "image"
  );
}

export class BookImageStore {
  constructor(
    private readonly resolveProject: (
      book: BookImageBookRef
    ) => Promise<string>,
    private readonly openImage: typeof open = open
  ) {}

  async write(
    input: BookImagesWriteInput
  ): Promise<{ images: BookImageReference[] }> {
    const parsed = BookImagesWriteInputSchema.parse(input);
    const directory = await assertImageDirectory(
      await this.resolveProject(parsed.book),
      true
    );
    const originalDirectory = await lstat(directory);
    const assertDirectoryUnchanged = async () => {
      const current = await lstat(directory);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== originalDirectory.dev ||
        current.ino !== originalDirectory.ino ||
        (await realpath(directory)) !== resolve(directory)
      )
        throw new Error("图片文件夹已变化。");
    };
    const images: BookImageReference[] = [];
    const written: { path: string; dev: number; ino: number }[] = [];
    try {
      for (const image of parsed.images) {
        const bytes = Buffer.from(image.bytes, "base64");
        if (!bytes.length || bytes.length > BOOK_IMAGE_MAX_BYTES)
          throw new Error("图片大小无效。");
        const png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg =
          bytes.length >= 3 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255;
        if ((image.ext === "png" && !png) || (image.ext === "jpg" && !jpeg))
          throw new Error("图片格式无效。");
        const stem = sanitizeBookImageBaseName(image.baseName);
        const file = `${stem}-${randomBytes(4).toString("hex")}.${image.ext}`;
        const path = join(directory, file);
        await assertDirectoryUnchanged();
        const handle = await this.openImage(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600
        );
        try {
          const opened = await handle.stat();
          written.push({ path, dev: opened.dev, ino: opened.ino });
          await assertDirectoryUnchanged();
          const current = await lstat(path);
          if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.dev !== opened.dev ||
            current.ino !== opened.ino
          )
            throw new Error("图片文件已变化。");
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        images.push({
          path: BookImagePathSchema.parse(`images/${file}`),
          alt: image.baseName.replace(/[\]\r\n]/gu, "").slice(0, 200)
        });
      }
      return { images };
    } catch (error) {
      for (const file of written) {
        try {
          await assertDirectoryUnchanged();
          const current = await lstat(file.path);
          if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.dev !== file.dev ||
            current.ino !== file.ino
          )
            continue;
          await assertDirectoryUnchanged();
          await unlink(file.path);
        } catch {
          // A changed directory or inode is no longer ours to remove.
        }
      }
      throw error;
    }
  }

  async resolve(
    book: BookImageBookRef,
    reference: string
  ): Promise<BookImagesResolveResult> {
    const relative = BookImagePathSchema.parse(reference);
    const directory = await assertImageDirectory(
      await this.resolveProject(book)
    );
    const path = join(directory, relative.slice("images/".length));
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > BOOK_IMAGE_MAX_BYTES ||
      (await realpath(path)) !== resolve(path)
    )
      throw new Error("图片不存在或无效。");
    return {
      path,
      mimeType: /\.png$/u.test(relative) ? "image/png" : "image/jpeg",
      byteSize: stat.size
    };
  }
}
