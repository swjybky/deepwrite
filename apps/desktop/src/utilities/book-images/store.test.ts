import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  symlink,
  writeFile,
  realpath,
  rename,
  open,
  unlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookImageStore, sanitizeBookImageBaseName } from "./store";
import { IMAGE_PNG } from "../../main/image/image-test-support";

const roots: string[] = [];
const book = { projectType: "short" as const, projectId: "book_test" };
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20
      })
    )
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-book-images-"));
  roots.push(root);
  return { root, store: new BookImageStore(async () => realpath(root)) };
}
const image = (baseName = "地图") => ({
  baseName,
  ext: "png" as const,
  bytes: IMAGE_PNG.toString("base64")
});

describe("book image disk store", () => {
  it("rejects malformed payloads and mismatched image formats before creating assets", async () => {
    const { root, store } = await setup();
    await expect(
      store.write({ book, images: [{ ...image(), ext: "jpg" }] })
    ).rejects.toThrow();
    expect(await readdir(join(root, "images"))).toEqual([]);
    await expect(store.resolve(book, "images/../escape.png")).rejects.toThrow();
  });
  it("writes unique immutable files and resolves plain files under the book", async () => {
    const { root, store } = await setup();
    const saved = await store.write({ book, images: [image(), image()] });
    expect(saved.images).toHaveLength(2);
    expect(saved.images[0]!.path).not.toBe(saved.images[1]!.path);
    expect(saved.images[0]).toMatchObject({ alt: "地图" });
    expect(saved.images[0]!.path).toMatch(/^images\/地图-[a-f0-9]{8}\.png$/u);
    const resolved = await store.resolve(book, saved.images[0]!.path);
    expect(resolved).toMatchObject({
      path: join(await realpath(root), saved.images[0]!.path),
      mimeType: "image/png",
      byteSize: IMAGE_PNG.length
    });
    expect(await readFile(resolved.path)).toEqual(IMAGE_PNG);
  });
  it("does not write bytes or remove an external file after the image directory changes during open", async () => {
    const { root } = await setup();
    const canonical = await realpath(root);
    const images = join(canonical, "images");
    const outside = join(canonical, "outside");
    await mkdir(outside);
    const store = new BookImageStore(
      async () => canonical,
      async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        await rename(images, join(canonical, "original-images"));
        await symlink(
          outside,
          images,
          process.platform === "win32" ? "junction" : "dir"
        );
        await writeFile(path, "unrelated external file");
        return handle;
      }
    );
    await expect(store.write({ book, images: [image()] })).rejects.toThrow(
      "图片文件夹已变化"
    );
    const files = await readdir(outside);
    expect(files).toHaveLength(1);
    expect(await readFile(join(outside, files[0]!), "utf8")).toBe(
      "unrelated external file"
    );
    const originalFiles = await readdir(join(canonical, "original-images"));
    expect(
      await readFile(join(canonical, "original-images", originalFiles[0]!))
    ).toEqual(Buffer.alloc(0));
  });
  it("does not remove a different inode substituted at a rollback path", async () => {
    const { root } = await setup();
    let replacedPath = "";
    const store = new BookImageStore(
      async () => realpath(root),
      async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          await unlink(path);
          await writeFile(path, "unrelated replacement");
        };
        replacedPath = String(path);
        return handle;
      }
    );
    await expect(
      store.write({
        book,
        images: [
          image(),
          { ...image(), bytes: Buffer.from("invalid image").toString("base64") }
        ]
      })
    ).rejects.toThrow();
    expect(await readFile(replacedPath, "utf8")).toBe("unrelated replacement");
  });
  it("refuses a project root replaced by a symlink before an image operation", async () => {
    const { root } = await setup();
    const canonical = await realpath(root);
    const project = join(canonical, "project");
    const outside = join(canonical, "outside-project");
    await mkdir(project);
    await mkdir(outside);
    await mkdir(join(outside, "images"));
    await writeFile(join(outside, "images", "map.png"), IMAGE_PNG);
    const store = new BookImageStore(async () => project);
    await rm(project, { recursive: true });
    await symlink(
      outside,
      project,
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(store.write({ book, images: [image()] })).rejects.toThrow(
      "作品文件夹必须是普通目录"
    );
    await expect(store.resolve(book, "images/map.png")).rejects.toThrow(
      "作品文件夹必须是普通目录"
    );
    expect(await readdir(join(outside, "images"))).toEqual(["map.png"]);
  });
  it("accepts a project reached through a linked ancestor directory", async () => {
    const { root } = await setup();
    const canonical = await realpath(root);
    const realParent = join(canonical, "real-parent");
    const project = join(realParent, "project");
    const linkedParent = join(canonical, "linked-parent");
    await mkdir(project, { recursive: true });
    await symlink(
      realParent,
      linkedParent,
      process.platform === "win32" ? "junction" : "dir"
    );
    const store = new BookImageStore(async () => join(linkedParent, "project"));
    const saved = await store.write({ book, images: [image()] });
    const resolved = await store.resolve(book, saved.images[0]!.path);
    expect(resolved.path).toBe(join(project, saved.images[0]!.path));
    expect(await readFile(resolved.path)).toEqual(IMAGE_PNG);
  });
  it("rolls back an incomplete multi-image write", async () => {
    const { root, store } = await setup();
    await expect(
      store.write({
        book,
        images: [
          image(),
          { ...image(), bytes: Buffer.from("not an image").toString("base64") }
        ]
      })
    ).rejects.toThrow();
    expect(await readdir(join(root, "images"))).toEqual([]);
  });
  it("refuses symlink image directories and asset symlinks", async () => {
    const { root, store } = await setup();
    const external = join(root, "outside");
    await mkdir(external);
    await writeFile(join(external, "external.png"), IMAGE_PNG);
    await symlink(
      external,
      join(root, "images"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(store.write({ book, images: [image()] })).rejects.toThrow();
    await expect(store.resolve(book, "images/external.png")).rejects.toThrow();
    await rm(join(root, "images"), { force: true });
    await mkdir(join(root, "images"));
    await symlink(
      join(external, "external.png"),
      join(root, "images", "link.png")
    );
    await expect(store.resolve(book, "images/link.png")).rejects.toThrow();
  });
  it("rejects empty and oversized assets and sanitizes reference-unsafe filenames", async () => {
    const { root, store } = await setup();
    await mkdir(join(root, "images"));
    await writeFile(join(root, "images", "empty.png"), "");
    await expect(store.resolve(book, "images/empty.png")).rejects.toThrow();
    expect(sanitizeBookImageBaseName("  .a: b)\\c*  ")).toBe("a--b--c");
    expect(sanitizeBookImageBaseName("foo..bar")).toBe("foo-bar");
    expect(sanitizeBookImageBaseName("... ")).toBe("image");
    expect(Array.from(sanitizeBookImageBaseName("字".repeat(60)))).toHaveLength(
      40
    );
  });
});
