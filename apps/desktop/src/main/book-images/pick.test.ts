import { mkdtemp, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeImage } from "electron";
import {
  BOOK_IMAGE_MAX_BYTES,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { withBookImageCommands } from "../../utilities/book-images/commands";
import type { FolderCatalogStore } from "../../utilities/folder-catalog-store";
import type { LongWorkspaceService } from "../../utilities/long-workspace-service";
import { prepareBookImage, pickBookImages } from "./pick";
import { IMAGE_PNG } from "../image/image-test-support";
const { showOpenDialog, createFromBuffer } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  createFromBuffer: vi.fn()
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog },
  nativeImage: { createFromBuffer }
}));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
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
async function file(name: string, bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-image-pick-"));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}
function decoder(width = 1, height = 1, png = IMAGE_PNG) {
  return vi.fn(
    () =>
      ({
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        toPNG: () => png
      }) as NativeImage
  );
}
describe("book image import validation", () => {
  it("routes validated selection through Core and returns references while rejecting bad files individually", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-image-pipeline-"));
    roots.push(root);
    const valid = await file("插图.png", IMAGE_PNG);
    const invalid = await file("invalid.gif", Buffer.from("GIF89a"));
    const book = { projectType: "long" as const, projectId: "book_test" };
    const handler = withBookImageCommands(
      async () => ({}) as FolderCatalogStore,
      {
        catalog: {
          open: async () => ({ projectDirectory: await realpath(root) })
        }
      } as unknown as LongWorkspaceService,
      async (command) => ({
        status: "rejected",
        requestId: command.id,
        error: { code: "unexpected", message: "unexpected" }
      })
    );
    const core = async (command: CommandEnvelope) =>
      handler(command, () => undefined, {
        worker: "core",
        requestId: command.id,
        requestInternalCommand: async () => {
          throw new Error("unexpected internal request");
        }
      });
    createFromBuffer.mockImplementation(decoder());
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [valid, invalid]
    });
    const result = await pickBookImages(null, { book }, core);
    expect(result).toMatchObject({
      status: "saved",
      images: [{ alt: "插图" }],
      rejected: [{ name: "invalid.gif", code: "book_image.unsupported_format" }]
    });
    if (result.status !== "saved") throw new Error("expected saved");
    const resolved = await core(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "bookImages.resolve",
          { book, path: result.images[0]!.path },
          { id: "cmd_resolve" }
        )
      )
    );
    expect(resolved).toMatchObject({
      status: "accepted",
      payload: { mimeType: "image/png", byteSize: IMAGE_PNG.length }
    });
  });
  it("rejects unsupported headers, excessive bytes, dimensions and symlinks", async () => {
    const invalid = await file("bad.gif", Buffer.from("GIF89a"));
    await expect(prepareBookImage(invalid, decoder())).rejects.toMatchObject({
      code: "book_image.unsupported_format"
    });
    const large = await file(
      "large.png",
      Buffer.alloc(BOOK_IMAGE_MAX_BYTES + 1)
    );
    await expect(prepareBookImage(large, decoder())).rejects.toMatchObject({
      code: "book_image.too_large"
    });
    const valid = await file("small.png", IMAGE_PNG);
    await expect(prepareBookImage(valid, decoder(8193))).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    const sof = Buffer.alloc(11);
    sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
    sof.writeUInt16BE(9000, 5);
    sof.writeUInt16BE(12000, 7);
    const panorama = await file(
      "panorama.jpg",
      Buffer.concat([Buffer.from([0xff, 0xd8]), sof])
    );
    const untouched = decoder();
    await expect(prepareBookImage(panorama, untouched)).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    expect(untouched).not.toHaveBeenCalled();
    const link = join(roots.at(-1)!, "link.png");
    await symlink(valid, link);
    await expect(prepareBookImage(link, decoder())).rejects.toThrow();
  });
  it("preserves PNG bytes through 8192 pixels and converts WebP to PNG", async () => {
    const path = await file("地图.png", IMAGE_PNG);
    expect(await prepareBookImage(path, decoder(8192))).toEqual({
      bytes: IMAGE_PNG.toString("base64"),
      ext: "png",
      baseName: "地图"
    });
    const webp = Buffer.from("RIFFxxxxWEBP");
    const webpPath = await file("original.webp", webp);
    const decode = decoder();
    expect(await prepareBookImage(webpPath, decode)).toEqual({
      bytes: IMAGE_PNG.toString("base64"),
      ext: "png",
      baseName: "original"
    });
    expect(decode).toHaveBeenCalledWith(webp);
  });
  it("falls back to the sandbox converter when nativeImage cannot decode WebP", async () => {
    const bytes = Buffer.from("RIFFxxxxWEBP");
    const path = await file("fallback.webp", bytes);
    const decode = decoder();
    decode.mockReturnValueOnce({ isEmpty: () => true } as NativeImage);
    const convert = vi.fn(async () => IMAGE_PNG);
    expect(await prepareBookImage(path, decode, convert)).toEqual({
      bytes: IMAGE_PNG.toString("base64"),
      ext: "png",
      baseName: "fallback"
    });
    expect(convert).toHaveBeenCalledWith(bytes);
    expect(decode).toHaveBeenLastCalledWith(IMAGE_PNG);
  });
  it("cancels without sending Core commands and rejects more than ten selections", async () => {
    const core = vi.fn();
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(
      await pickBookImages(
        null,
        { book: { projectType: "short", projectId: "book_test" } },
        core
      )
    ).toEqual({ status: "cancelled" });
    expect(core).not.toHaveBeenCalled();
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: Array.from({ length: 11 }, (_, i) => `/invalid/image-${i}.png`)
    });
    await expect(
      pickBookImages(
        null,
        { book: { projectType: "short", projectId: "book_test" } },
        core
      )
    ).rejects.toMatchObject({ code: "book_image.too_large" });
    expect(core).not.toHaveBeenCalled();
  });
  it("reports rejected files without leaking their local paths", async () => {
    const path = await file("bad.gif", Buffer.from("GIF89a"));
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [path]
    });
    const core = vi.fn();
    expect(
      await pickBookImages(
        null,
        { book: { projectType: "short", projectId: "book_test" } },
        core
      )
    ).toEqual({
      status: "saved",
      images: [],
      rejected: [{ name: "bad.gif", code: "book_image.unsupported_format" }]
    });
    expect(core).not.toHaveBeenCalled();
  });
});
