import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBookImage } from "./read";
import { verifyBookImageHandle } from "./verify-file";
import { IMAGE_PNG } from "../image/image.test-support";
vi.mock("electron", () => ({ nativeImage: {} }));
const roots: string[] = [];
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
  const root = await mkdtemp(join(tmpdir(), "deepwrite-image-read-"));
  roots.push(root);
  const canonical = await realpath(root);
  const images = join(canonical, "images");
  await mkdir(images);
  const path = join(images, "map.png");
  await writeFile(path, IMAGE_PNG);
  return {
    root: canonical,
    images,
    path,
    asset: { path, mimeType: "image/png" as const, byteSize: IMAGE_PNG.length }
  };
}
describe("book image export file reads", () => {
  it("requires the approved size, header and ordinary book image location", async () => {
    const { root, path, asset } = await setup();
    expect(await readBookImage(asset)).toEqual(IMAGE_PNG);
    await expect(
      readBookImage({ ...asset, byteSize: asset.byteSize + 1 })
    ).rejects.toThrow();
    await expect(
      readBookImage({ ...asset, mimeType: "image/jpeg" })
    ).rejects.toThrow();
    const outside = join(root, "outside.png");
    await writeFile(outside, IMAGE_PNG);
    await expect(readBookImage({ ...asset, path: outside })).rejects.toThrow();
    const link = join(root, "images", "link.png");
    await symlink(path, link);
    await expect(readBookImage({ ...asset, path: link })).rejects.toThrow();
  });
  it("refuses a parent symlink substituted after Core resolved the image", async () => {
    const { root, images, asset } = await setup();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "map.png"), IMAGE_PNG);
    await rename(images, join(root, "original-images"));
    await symlink(
      outside,
      images,
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(readBookImage(asset)).rejects.toThrow();
  });
  it("refuses an external opened inode even if the original path is restored before validation", async () => {
    const { root, asset } = await setup();
    const external = join(root, "external.png");
    await writeFile(external, IMAGE_PNG);
    const handle = await open(external, "r");
    try {
      await expect(verifyBookImageHandle(asset, handle)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  });
});
