import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishTagRelease } from "./publish-tag-release.mjs";
const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture(
  names = ["DeepWrite-1.2.3-win-x64-test.exe", "latest.yml"]
) {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-release-upload-"));
  roots.push(directory);
  const files = [];
  for (const name of names) {
    const data = Buffer.from(`invalid-test-artifact:${name}`);
    await writeFile(join(directory, name), data);
    files.push({
      name,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex")
    });
  }
  await writeFile(join(directory, "assets.json"), JSON.stringify(files));
  let release;
  let assets = [];
  const repos = {
    getReleaseByTag: vi.fn(async () => {
      if (!release)
        throw Object.assign(new Error("not found"), { status: 404 });
      return { data: release };
    }),
    createRelease: vi.fn(async (data) => {
      release = {
        id: 1,
        draft: true,
        body: data.body,
        tag_name: data.tag_name,
        prerelease: false
      };
      return { data: release };
    }),
    listReleaseAssets: vi.fn(),
    uploadReleaseAsset: vi.fn(async ({ name, data }) => {
      const asset = {
        id: assets.length + 1,
        name,
        size: data.length,
        state: "uploaded",
        digest: `sha256:${createHash("sha256").update(data).digest("hex")}`
      };
      assets.push(asset);
      return { data: asset };
    }),
    deleteReleaseAsset: vi.fn(async ({ asset_id }) => {
      assets = assets.filter((asset) => asset.id !== asset_id);
    }),
    updateRelease: vi.fn(async () => ({
      data: {
        ...release,
        draft: false,
        html_url: "https://example.test/releases/tag/v1.2.3"
      }
    }))
  };
  const github = {
    rest: { repos },
    paginate: vi.fn(async () => assets.map((asset) => ({ ...asset })))
  };
  const options = {
    github,
    context: {
      runId: 123,
      sha: "test-only-commit",
      repo: { owner: "fixture", repo: "fixture" }
    },
    directory,
    tag: "v1.2.3"
  };
  return {
    options,
    repos,
    files,
    setRelease: (value) => {
      release = value;
    },
    assets: () => assets
  };
}

describe("tag release publication", () => {
  it("creates a draft, uploads all verified assets and only then publishes", async () => {
    const { options, repos } = await fixture();
    await expect(publishTagRelease(options)).resolves.toContain("example.test");
    expect(repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: true,
        generate_release_notes: true,
        tag_name: "v1.2.3"
      })
    );
    expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(2);
    expect(repos.updateRelease.mock.invocationCallOrder[0]).toBeGreaterThan(
      repos.uploadReleaseAsset.mock.invocationCallOrder[1]
    );
  });
  it("accepts arm64 installers and their update manifests", async () => {
    const { options, repos } = await fixture([
      "DeepWrite-1.2.3-win-arm64-test.exe",
      "latest-arm64.yml",
      "DeepWrite-1.2.3-linux-arm64-test.deb",
      "latest-linux-arm64.yml"
    ]);
    await expect(publishTagRelease(options)).resolves.toContain("example.test");
    expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(4);
  });
  it.each([
    { draft: false, body: "<!-- deepwrite-tag-build:123 -->" },
    { draft: true, body: "manual draft" }
  ])("preserves published releases and unrelated drafts", async (existing) => {
    const { options, repos, setRelease } = await fixture();
    setRelease({ id: 1, ...existing });
    await expect(publishTagRelease(options)).rejects.toThrow("already has");
    expect(repos.uploadReleaseAsset).not.toHaveBeenCalled();
    expect(repos.updateRelease).not.toHaveBeenCalled();
  });
  it("leaves failed uploads in draft and resumes the same run without duplicating matching assets", async () => {
    const { options, repos } = await fixture();
    const upload = repos.uploadReleaseAsset.getMockImplementation();
    repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockRejectedValueOnce(new Error("test upload failure"));
    await expect(publishTagRelease(options)).rejects.toThrow(
      "test upload failure"
    );
    expect(repos.updateRelease).not.toHaveBeenCalled();
    await expect(publishTagRelease(options)).resolves.toContain("example.test");
    expect(repos.createRelease).toHaveBeenCalledTimes(1);
    expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(3);
  });
  it("does not publish an asset changed after checksum validation", async () => {
    const { options, repos, files } = await fixture();
    await writeFile(
      join(options.directory, files[0].name),
      "invalid-modified-test-artifact"
    );
    await expect(publishTagRelease(options)).rejects.toThrow(
      "changed after validation"
    );
    expect(repos.updateRelease).not.toHaveBeenCalled();
  });
  it("does not publish if GitHub reports an incomplete asset", async () => {
    const { options, repos } = await fixture();
    const upload = repos.uploadReleaseAsset.getMockImplementation();
    repos.uploadReleaseAsset.mockImplementation(async (input) => {
      const result = await upload(input);
      result.data.size++;
      return result;
    });
    await expect(publishTagRelease(options)).rejects.toThrow("do not match");
    expect(repos.updateRelease).not.toHaveBeenCalled();
  });
});
