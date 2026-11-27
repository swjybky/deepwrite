import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoverProtocolHandler,
  registerCoverScheme
} from "./cover-protocol";
import { IMAGE_PNG } from "../../main/image/image.test-support";

vi.mock("electron", () => ({ protocol: {} }));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("cover image protocol", () => {
  it("registers a secure CORS-enabled fetchable image scheme", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerCoverScheme({ registerSchemesAsPrivileged });
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "deepwrite-cover",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true
        }
      }
    ]);
  });

  it("serves only registered referenced files and allows revision cache keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-cover-protocol-"));
    roots.push(root);
    const path = join(root, "image.png");
    await writeFile(path, IMAGE_PNG);
    const resolve = vi.fn(async () => ({
      path,
      byteSize: IMAGE_PNG.length,
      mimeType: "image/png"
    }));
    const handler = createCoverProtocolHandler(resolve);
    const response = await handler(
      new Request(
        "deepwrite-cover://asset/short/book_test/covers/img_test.png?revision=2"
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_PNG);
    expect(resolve).toHaveBeenCalledWith(
      { projectType: "short", projectId: "book_test" },
      "covers/img_test.png"
    );
  });

  it.each([
    "deepwrite-cover://asset/short/book_test/covers/%2e%2e/identity.json",
    "deepwrite-cover://asset/short/book_test/covers/img_test%2fpng",
    "deepwrite-cover://asset/short/book_test/covers/img_test.png?secret=invalid",
    "deepwrite-cover://unknown/short/book_test/cover.png",
    "deepwrite-cover://asset/short/book_test/identity.json"
  ])("rejects malformed paths without querying Core: %s", async (url) => {
    const resolver = vi.fn();
    expect(
      (await createCoverProtocolHandler(resolver)(new Request(url))).status
    ).toBe(400);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns 404 for unregistered IDs and 405 for non-GET", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("unknown work"));
    const handler = createCoverProtocolHandler(resolver);
    expect(
      (
        await handler(
          new Request("deepwrite-cover://asset/long/book_unknown/cover.png")
        )
      ).status
    ).toBe(404);
    expect(
      (
        await handler(
          new Request("deepwrite-cover://asset/long/book_unknown/cover.png", {
            method: "POST"
          })
        )
      ).status
    ).toBe(405);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
