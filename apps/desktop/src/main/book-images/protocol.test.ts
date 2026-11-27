import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  mkdir,
  rename,
  open,
  realpath
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBookImageProtocolHandler,
  registerBookImageScheme
} from "./protocol";
import { IMAGE_PNG } from "../image/image.test-support";
vi.mock("electron", () => ({ protocol: {} }));
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
const url = "deepwrite-book-image://asset/short/book_test/map.png";
describe("book image protocol", () => {
  it.each([
    "deepwrite-book-image://unknown/short/book_test/map.png",
    "deepwrite-book-image://asset/short/book_test/map.png?revision=1",
    "deepwrite-book-image://asset/short/book_test/map.png#fragment",
    "deepwrite-book-image://asset/short/book_test/..%2fmap.png",
    "deepwrite-book-image://asset/short/book_test/map%5cfile.png",
    "deepwrite-book-image://asset/short/book_test/%2e%2e/map.png",
    "deepwrite-book-image://asset/short/book_test/map.gif"
  ])("rejects invalid URL before resolving: %s", async (path) => {
    const resolver = vi.fn();
    expect(
      (await createBookImageProtocolHandler(resolver)(new Request(path))).status
    ).toBe(400);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("streams a bounded plain file and reports missing/method errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-image-protocol-"));
    roots.push(root);
    await mkdir(join(root, "images"));
    const path = join(await realpath(root), "images", "map.png");
    await writeFile(path, IMAGE_PNG);
    const resolve = vi.fn(async () => ({
      path,
      byteSize: IMAGE_PNG.length,
      mimeType: "image/png" as const
    }));
    const handler = createBookImageProtocolHandler(resolve);
    const response = await handler(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_PNG);
    expect(resolve).toHaveBeenCalledWith(
      { projectType: "short", projectId: "book_test" },
      "images/map.png"
    );
    expect((await handler(new Request(url, { method: "POST" }))).status).toBe(
      405
    );
    expect(
      (
        await createBookImageProtocolHandler(async () => {
          throw new Error("missing");
        })(new Request(url))
      ).status
    ).toBe(404);
    const link = join(root, "link.png");
    await symlink(path, link);
    expect(
      (
        await createBookImageProtocolHandler(async () => ({
          path: link,
          byteSize: IMAGE_PNG.length,
          mimeType: "image/png"
        }))(new Request(url))
      ).status
    ).toBe(404);
  });
  it("queues extra images while keeping at most eight active streams", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-image-concurrency-"));
    roots.push(root);
    await mkdir(join(root, "images"));
    const path = join(await realpath(root), "images", "map.png");
    await writeFile(path, IMAGE_PNG);
    let allow!: () => void;
    const gate = new Promise<void>((resolve) => {
      allow = resolve;
    });
    let started = 0;
    let eightStarted!: () => void;
    const eight = new Promise<void>((resolve) => {
      eightStarted = resolve;
    });
    const resolver = vi.fn(async () => {
      started += 1;
      if (started === 8) eightStarted();
      await gate;
      return {
        path,
        byteSize: IMAGE_PNG.length,
        mimeType: "image/png" as const
      };
    });
    const handler = createBookImageProtocolHandler(resolver);
    const responses = Array.from({ length: 9 }, () =>
      handler(new Request(url))
    );
    await eight;
    expect(resolver).toHaveBeenCalledTimes(8);
    allow();
    await Promise.all(
      responses.map(async (pending) => {
        const response = await pending;
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_PNG);
      })
    );
    expect(resolver).toHaveBeenCalledTimes(9);
  });
  it("removes aborted queued requests without consuming a stream slot", async () => {
    let allow!: () => void;
    const gate = new Promise<void>((resolve) => {
      allow = resolve;
    });
    const handler = createBookImageProtocolHandler(async () => {
      await gate;
      throw new Error("missing");
    });
    const active = Array.from({ length: 8 }, () => handler(new Request(url)));
    const controller = new AbortController();
    const queued = handler(new Request(url, { signal: controller.signal }));
    controller.abort();
    expect((await queued).status).toBe(499);
    allow();
    await Promise.all(active);
    expect((await handler(new Request(url))).status).toBe(404);
  });
  it("rejects a parent image directory changed to a symlink after Core resolves it", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-image-parent-race-"));
    roots.push(root);
    const canonical = await realpath(root);
    const images = join(canonical, "images");
    const outside = join(canonical, "outside");
    await mkdir(images);
    await mkdir(outside);
    await writeFile(join(images, "map.png"), IMAGE_PNG);
    await writeFile(join(outside, "map.png"), IMAGE_PNG);
    const handler = createBookImageProtocolHandler(
      async () => ({
        path: join(images, "map.png"),
        mimeType: "image/png",
        byteSize: IMAGE_PNG.length
      }),
      async (path, flags) => {
        await rename(images, join(canonical, "original-images"));
        await symlink(
          outside,
          images,
          process.platform === "win32" ? "junction" : "dir"
        );
        return open(path, flags);
      }
    );
    expect((await handler(new Request(url))).status).toBe(404);
  });
  it("registers a secure fetchable image scheme", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerBookImageScheme({ registerSchemesAsPrivileged });
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: "deepwrite-book-image",
        privileges: expect.objectContaining({
          secure: true,
          standard: true,
          stream: true
        })
      })
    ]);
  });
});
