import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  downloadReleaseAssets,
  resolvePublishedTag
} from "./download-release-assets.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "release-download-"));
  roots.push(directory);
  const bytes = "synthetic release";
  const release = {
    tag_name: "v9.8.7",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "installer.exe",
        size: Buffer.byteLength(bytes),
        state: "uploaded",
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        browser_download_url:
          "https://github.com/example-owner/example-repo/releases/download/v9.8.7/installer.exe"
      }
    ]
  };
  const fetcher = vi
    .fn(async () => new Response(JSON.stringify(release)))
    .mockImplementationOnce(async () => new Response(JSON.stringify(release)));
  const invoke = () =>
    downloadReleaseAssets({
      repository: "example-owner/example-repo",
      tag: "v9.8.7",
      directory,
      token: "invalid-fixture-token",
      fetcher
    });
  return { directory, bytes, release, fetcher, invoke };
}

it("verifies downloaded bytes without passing repository credentials to asset hosts", async () => {
  const f = await fixture();
  f.fetcher.mockImplementationOnce(async () => new Response(f.bytes));
  expect(await f.invoke()).toBe(1);
  expect(await readFile(join(f.directory, "installer.exe"), "utf8")).toBe(
    f.bytes
  );
  expect(f.fetcher.mock.calls[1][1].headers).toBeUndefined();
});

it.each(["draft", "prerelease", "path", "digest", "host", "duplicate"])(
  "rejects invalid release %s before downloading files",
  async (kind) => {
    const f = await fixture();
    if (kind === "draft" || kind === "prerelease") f.release[kind] = true;
    if (kind === "path") f.release.assets[0].name = "../installer.exe";
    if (kind === "digest") f.release.assets[0].digest = "invalid";
    if (kind === "host")
      f.release.assets[0].browser_download_url =
        "https://example.test/file.exe";
    if (kind === "duplicate") f.release.assets.push({ ...f.release.assets[0] });
    await expect(f.invoke()).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  }
);

it("rejects a corrupted download before publication", async () => {
  const f = await fixture();
  f.fetcher.mockImplementationOnce(async () => new Response("corrupted"));
  await expect(f.invoke()).rejects.toThrow("下载校验失败");
});

it("derives the tag from the published manifest and rejects mismatches or injected environment lines", () => {
  const manifest = {
    schemaVersion: 1,
    version: "9.8.7",
    title: "Fixture",
    publishedAt: "2026-01-01T00:00:00Z",
    releaseNotes: [],
    releasePage: "https://example.test/release",
    feedUrl: "https://example.test/feed"
  };
  expect(resolvePublishedTag(manifest)).toBe("v9.8.7");
  expect(resolvePublishedTag(manifest, "v9.8.7")).toBe("v9.8.7");
  expect(() => resolvePublishedTag(manifest, "v9.8.6")).toThrow("版本一致");
  expect(() =>
    resolvePublishedTag(manifest, "v9.8.7\nUNEXPECTED=value")
  ).toThrow();
  expect(() =>
    resolvePublishedTag({ ...manifest, version: "9.8.7-beta" })
  ).toThrow();
});
