import { describe, expect, it, vi } from "vitest";
import {
  cleanupR2Storage,
  listR2Objects,
  prepareR2Upload,
  R2_STORAGE_LIMIT
} from "./r2-storage.mjs";

const manifest = {
  schemaVersion: 1,
  version: "9.8.7",
  title: "Fixture",
  publishedAt: "2026-01-01T00:00:00Z",
  releaseNotes: [],
  releasePage: "https://example.test/release",
  feedUrl: "https://example.test/releases/v9.8.7"
};
const xml = (objects, token) =>
  `<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>${Boolean(token)}</IsTruncated>${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ""}${objects.map(({ key, size }) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${size}</Size></Contents>`).join("")}</ListBucketResult>`;

function fixture(entries = []) {
  const objects = new Map(entries.map((o) => [o.key, o.size]));
  const body = JSON.stringify(manifest);
  objects.set("update.json", Buffer.byteLength(body));
  const request = vi.fn(async (method, key) => {
    if (method === "GET" && key === "update.json")
      return new Response(body, { headers: { etag: '"fixture-etag"' } });
    if (method === "GET" && key === "")
      return new Response(
        xml([...objects].map(([key, size]) => ({ key, size })))
      );
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected request");
  });
  const release = {
    prefix: "releases/v9.8.8",
    manifest: {
      ...manifest,
      version: "9.8.8",
      feedUrl: "https://example.test/releases/v9.8.8"
    },
    files: [{ name: "installer.exe", size: 100 }]
  };
  return { request, objects, release };
}

describe("R2 storage retention and upload limit", () => {
  it("counts every page and decodes URL-encoded object keys", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          xml([{ key: "file &<中文>.zip", size: 123 }], "next+token")
        )
      )
      .mockResolvedValueOnce(
        new Response(xml([{ key: "health.json", size: 2 }]))
      );
    expect(await listR2Objects(request)).toEqual([
      { key: "file &<中文>.zip", size: 123 },
      { key: "health.json", size: 2 }
    ]);
    expect(request.mock.calls[1][2].query["continuation-token"]).toBe(
      "next+token"
    );
  });

  it.each([
    "<ListBucketResult>",
    "<Error><Message>Denied</Message></Error>",
    "<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated></ListBucketResult>",
    xml([{ key: "bad.exe", size: -1 }]),
    xml([{ key: "bad.exe", size: Number.MAX_SAFE_INTEGER + 1 }])
  ])("fails closed on an invalid or incomplete inventory", async (body) => {
    const request = vi.fn(async () => new Response(body));
    await expect(listR2Objects(request)).rejects.toThrow();
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("rejects repeated pagination tokens instead of using a partial inventory", async () => {
    const request = vi.fn(async () => new Response(xml([], "same-token")));
    await expect(listR2Objects(request)).rejects.toThrow("游标无效");
  });

  it("blocks an upload when old and new releases together would exceed 10 GB", async () => {
    const f = fixture([
      { key: "releases/v9.8.7/installer.exe", size: 9_500_000_000 }
    ]);
    f.release.files[0].size = 600_000_000;
    await expect(prepareR2Upload(f.request, f.release)).rejects.toThrow(
      "超过 10 GB"
    );
    expect(f.objects.has("releases/v9.8.7/installer.exe")).toBe(true);
    expect(f.request.mock.calls.some(([m]) => m !== "GET")).toBe(false);
  });

  it("allows the exact limit, including pointer replacement and unmanaged files", async () => {
    const f = fixture([{ key: "other.bin", size: 1_000_000_000 }]);
    const pointerSize = Buffer.byteLength(
      JSON.stringify(f.release.manifest, null, 2) + "\n"
    );
    f.release.files[0].size = R2_STORAGE_LIMIT - 1_000_000_000 - pointerSize;
    expect(await prepareR2Upload(f.request, f.release)).toBe(R2_STORAGE_LIMIT);
    f.release.files[0].size += 1;
    await expect(prepareR2Upload(f.request, f.release)).rejects.toThrow(
      "超过 10 GB"
    );
  });

  it("clears abandoned releases before budgeting and counts resumed uploads once", async () => {
    const f = fixture([
      { key: "releases/v9.8.6/failed.exe", size: R2_STORAGE_LIMIT },
      { key: "releases/v9.8.7/current.exe", size: 1_000 },
      { key: "releases/v9.8.8/installer.exe", size: 100 },
      { key: "health.json", size: 2 }
    ]);
    const projected = await prepareR2Upload(f.request, f.release);
    expect(f.objects.has("releases/v9.8.6/failed.exe")).toBe(false);
    expect(f.objects.has("releases/v9.8.7/current.exe")).toBe(true);
    expect(f.objects.has("releases/v9.8.8/installer.exe")).toBe(true);
    expect(projected).toBe(
      1_102 +
        Buffer.byteLength(JSON.stringify(f.release.manifest, null, 2) + "\n")
    );
  });

  it("refuses older uploads before deleting any releases", async () => {
    const f = fixture([{ key: "releases/v9.8.8/current.exe", size: 1_000 }]);
    f.release.manifest.version = "9.8.6";
    await expect(prepareR2Upload(f.request, f.release)).rejects.toThrow(
      "拒绝上传旧版本"
    );
    expect(f.request.mock.calls).toHaveLength(1);
  });

  it("only deletes managed release paths and keeps the active version", async () => {
    const f = fixture([
      { key: "releases/v9.8.6/old.exe", size: 123 },
      { key: "releases/v9.8.7/current.exe", size: 1_000 },
      { key: "releases/notes.txt", size: 10 },
      { key: "releases/v9.8.6/../health.json", size: 2 },
      { key: "health.json", size: 2 }
    ]);
    expect(await cleanupR2Storage(f.request)).toMatchObject({
      deleted: 1,
      objects: 5
    });
    expect(f.objects.has("releases/v9.8.7/current.exe")).toBe(true);
    expect(f.objects.has("releases/notes.txt")).toBe(true);
    expect(f.objects.has("releases/v9.8.6/../health.json")).toBe(true);
    expect(f.objects.has("health.json")).toBe(true);
    expect(await cleanupR2Storage(f.request)).toMatchObject({ deleted: 0 });
  });

  it("stops deletion if the active pointer changes during inventory", async () => {
    const f = fixture([{ key: "releases/v9.8.6/old.exe", size: 123 }]);
    f.request.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify(manifest), {
          headers: { etag: '"previous-etag"' }
        })
    );
    await expect(cleanupR2Storage(f.request)).rejects.toThrow("当前版本已改变");
    expect(f.objects.has("releases/v9.8.6/old.exe")).toBe(true);
  });

  it("reports a deletion failure so the workflow can retry cleanup", async () => {
    const f = fixture([{ key: "releases/v9.8.6/old.exe", size: 123 }]);
    const original = f.request.getMockImplementation();
    f.request.mockImplementation((method, key) =>
      method === "DELETE"
        ? new Response(null, { status: 503 })
        : original(method, key)
    );
    await expect(cleanupR2Storage(f.request)).rejects.toThrow("503");
    f.request.mockImplementation(original);
    expect(await cleanupR2Storage(f.request)).toMatchObject({ deleted: 1 });
  });

  it("does not delete anything without an active version pointer", async () => {
    const request = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(cleanupR2Storage(request)).rejects.toThrow("拒绝清理");
    expect(request.mock.calls).toEqual([["GET", "update.json"]]);
  });
});
