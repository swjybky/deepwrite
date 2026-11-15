import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateR2Release,
  createR2Client,
  loadR2Release,
  readR2Config,
  uploadR2Release
} from "./publish-r2-release.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const config = {
  accountId: "a".repeat(32),
  bucket: "example-updates",
  publicUrl: "https://example.test",
  accessKeyId: "invalid-fixture-id",
  secretAccessKey: "invalid-fixture-secret"
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "r2-release-"));
  roots.push(directory);
  const artifact = Buffer.from("synthetic installer");
  await writeFile(join(directory, "installer.exe"), artifact);
  await writeFile(
    join(directory, "latest.yml"),
    `version: 9.8.7\nfiles:\n  - url: installer.exe\n    size: ${artifact.length}\n    sha512: ${createHash("sha512").update(artifact).digest("base64")}\n`
  );
  const manifest = {
    schemaVersion: 1,
    enabled: true,
    channel: "stable",
    version: "9.8.7",
    title: "Fixture",
    publishedAt: "2026-01-01T00:00:00Z",
    releaseNotes: [],
    mandatory: false,
    releasePage: "https://example.test/release",
    feedUrl: "https://example.test/old"
  };
  const manifestPath = join(directory, "source.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const release = await loadR2Release(
    directory,
    manifestPath,
    "v9.8.7",
    config.publicUrl
  );
  const objects = new Map();
  const puts = [];
  const request = vi.fn(async (method, key, options = {}) => {
    if (method === "GET" && key === "") {
      const contents = [...objects].map(
        ([key, object]) =>
          `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${object.size ?? Buffer.byteLength(object.body)}</Size></Contents>`
      );
      return new Response(
        `<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${contents.join("")}</ListBucketResult>`
      );
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const object = objects.get(key);
    if (method === "HEAD")
      return object
        ? new Response(null, {
            headers: {
              "content-length": String(object.size),
              "x-amz-meta-sha256": object.sha256
            }
          })
        : new Response(null, { status: 404 });
    if (method === "GET")
      return object
        ? new Response(object.body, { headers: { etag: '"fixture-etag"' } })
        : new Response(null, { status: 404 });
    if (method !== "PUT") throw new Error("Unexpected request");
    let body = options.body;
    if (typeof body !== "string") {
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    expect(sha256).toBe(options.sha256);
    objects.set(key, { body, size: Buffer.byteLength(body), sha256 });
    puts.push({ key, headers: options.headers });
    return new Response(null);
  });
  return { directory, manifestPath, manifest, release, request, objects, puts };
}

describe("R2 release publication", () => {
  it("uploads immutable downloads first, verifies them, and activates a separate no-store pointer", async () => {
    const f = await fixture();
    await uploadR2Release(f.request, f.release);
    expect(f.puts.at(-1).key).toBe("releases/v9.8.7/latest.yml");
    expect(
      f.puts.every((p) => p.headers["cache-control"].includes("immutable"))
    ).toBe(true);
    expect(f.objects.has("update.json")).toBe(false);
    expect(await activateR2Release(f.request, f.release)).toBe(true);
    expect(f.puts.at(-1)).toMatchObject({
      key: "update.json",
      headers: { "if-none-match": "*", "cache-control": "no-store" }
    });
    expect(JSON.parse(f.objects.get("update.json").body).feedUrl).toBe(
      "https://example.test/releases/v9.8.7"
    );
  });

  it("resumes without reuploading completed files", async () => {
    const f = await fixture();
    await uploadR2Release(f.request, f.release);
    const count = f.puts.length;
    await uploadR2Release(f.request, f.release);
    expect(f.puts).toHaveLength(count);
  });

  it("keeps the active release during upload, then deletes it only after activation", async () => {
    const f = await fixture();
    f.objects.set("update.json", {
      body: JSON.stringify({ ...f.manifest, version: "9.8.6" })
    });
    f.objects.set("releases/v9.8.6/old.exe", { size: 123 });
    f.objects.set("health.json", { body: "{}", size: 2 });
    await uploadR2Release(f.request, f.release);
    expect(f.objects.has("releases/v9.8.6/old.exe")).toBe(true);
    await activateR2Release(f.request, f.release);
    expect(f.objects.has("releases/v9.8.6/old.exe")).toBe(false);
    expect(f.objects.has("releases/v9.8.7/installer.exe")).toBe(true);
    expect(f.objects.has("health.json")).toBe(true);
  });

  it("does not delete the active release if activation fails", async () => {
    const f = await fixture();
    f.objects.set("update.json", {
      body: JSON.stringify({ ...f.manifest, version: "9.8.6" })
    });
    f.objects.set("releases/v9.8.6/old.exe", { size: 123 });
    await uploadR2Release(f.request, f.release);
    const original = f.request.getMockImplementation();
    f.request.mockImplementation((method, key, options) =>
      method === "PUT" && key === "update.json"
        ? new Response(null, { status: 412 })
        : original(method, key, options)
    );
    await expect(activateR2Release(f.request, f.release)).rejects.toThrow(
      "412"
    );
    expect(f.objects.has("releases/v9.8.6/old.exe")).toBe(true);
  });

  it("refuses activation after a missing file or conflicting remote content", async () => {
    const f = await fixture();
    await expect(activateR2Release(f.request, f.release)).rejects.toThrow(
      "尚未全部上传"
    );
    f.objects.set("releases/v9.8.7/installer.exe", {
      size: 1,
      sha256: "invalid"
    });
    await expect(uploadR2Release(f.request, f.release)).rejects.toThrow(
      "内容冲突"
    );
    expect(f.objects.has("update.json")).toBe(false);
  });

  it("does not activate on an upload failure", async () => {
    const f = await fixture();
    f.request
      .mockImplementationOnce(async () => new Response(null, { status: 404 }))
      .mockImplementationOnce(async () => new Response(null, { status: 503 }));
    await expect(uploadR2Release(f.request, f.release)).rejects.toThrow("503");
    expect(f.objects.has("update.json")).toBe(false);
  });

  it("stops before sending any file when the upload would exceed the storage limit", async () => {
    const f = await fixture();
    f.release.files[0].size = 10_000_000_000;
    await expect(uploadR2Release(f.request, f.release)).rejects.toThrow(
      "超过 10 GB"
    );
    expect(f.puts).toHaveLength(0);
    expect(f.objects.size).toBe(0);
  });

  it("keeps a newer pointer and uses conditional writes for an older pointer", async () => {
    const f = await fixture();
    await uploadR2Release(f.request, f.release);
    f.objects.set("update.json", {
      body: JSON.stringify({ ...f.manifest, version: "9.8.8" })
    });
    expect(await activateR2Release(f.request, f.release)).toBe(false);
    f.objects.set("update.json", {
      body: JSON.stringify({ ...f.manifest, version: "9.8.6" })
    });
    expect(await activateR2Release(f.request, f.release)).toBe(true);
    expect(f.puts.at(-1).headers["if-match"]).toBe('"fixture-etag"');
  });

  it("uses the original response representation so conditional activation has a strong ETag", async () => {
    const f = await fixture();
    await uploadR2Release(f.request, f.release);
    f.objects.set("update.json", { body: JSON.stringify(f.manifest) });
    const request = createR2Client(config, async (url, options) => {
      const key = new URL(url).pathname.split("/").slice(2).join("/");
      const headers = new Headers(options.headers);
      if (headers.get("if-match")?.startsWith("W/")) {
        return new Response(null, { status: 412 });
      }
      const response = await f.request(options.method, key, {
        body: options.body,
        size: Number(headers.get("content-length")),
        sha256: headers.get("x-amz-content-sha256"),
        headers: Object.fromEntries(headers)
      });
      if (
        options.method === "GET" &&
        headers.get("accept-encoding") !== "identity"
      ) {
        response.headers.set("etag", 'W/"fixture-etag"');
      }
      return response;
    });
    expect(await activateR2Release(request, f.release)).toBe(true);
    expect(f.puts.at(-1).headers["if-match"]).toBe('"fixture-etag"');
  });

  it("rejects a mismatched manifest before any upload", async () => {
    const f = await fixture();
    await expect(
      loadR2Release(f.directory, f.manifestPath, "v9.8.8", config.publicUrl)
    ).rejects.toThrow("版本");
    await writeFile(join(f.directory, "installer.exe"), "changed installer");
    await expect(
      loadR2Release(f.directory, f.manifestPath, "v9.8.7", config.publicUrl)
    ).rejects.toThrow("校验值");
  });

  it("signs R2 requests without sending credentials to a download host", async () => {
    const fetcher = vi.fn(async () => new Response(null));
    await createR2Client(config, fetcher)(
      "HEAD",
      "releases/v9.8.7/file name.exe"
    );
    expect(fetcher).toHaveBeenCalledWith(
      `https://${"a".repeat(32)}.r2.cloudflarestorage.com/example-updates/releases/v9.8.7/file%20name.exe`,
      expect.objectContaining({
        method: "HEAD",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("AWS4-HMAC-SHA256"),
          "accept-encoding": "identity"
        })
      })
    );
  });

  it("preserves an opaque listing cursor in the signed request URL", async () => {
    const fetcher = vi.fn(async () => new Response(null));
    const cursor = "opaque+cursor/with=padding";
    await createR2Client(config, fetcher)("GET", "", {
      query: { "list-type": "2", "continuation-token": cursor }
    });
    const url = new URL(fetcher.mock.lastCall[0]);
    expect(url.pathname).toBe("/example-updates/");
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("continuation-token")).toBe(cursor);
  });

  it.each([
    undefined,
    "{}",
    JSON.stringify({ ...config, publicUrl: "http://example.test" }),
    JSON.stringify({ ...config, publicUrl: "https://example.test/path" })
  ])("rejects incomplete or unsafe config", (source) => {
    expect(() => readR2Config(source)).toThrow();
  });
});
