import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { prepareReleaseAssets } from "./prepare-release-assets.mjs";
const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const builderRequire = createRequire(require.resolve("electron-builder"));
const yaml = createRequire(builderRequire.resolve("app-builder-lib"))(
  "js-yaml"
);
const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-release-assets-"));
  roots.push(root);
  const input = join(root, "input"),
    output = join(root, "output");
  const groups = [
    [
      "win-x64",
      "latest.yml",
      ["win-x64-test.exe", "win-x64-test.exe.blockmap"]
    ],
    [
      "win-arm64",
      "latest-arm64.yml",
      ["win-arm64-test.exe", "win-arm64-test.exe.blockmap"]
    ],
    [
      "mac-arm64",
      "latest-mac.yml",
      [
        "mac-arm64-test.zip",
        "mac-arm64-test.dmg",
        "mac-arm64-test.zip.blockmap"
      ]
    ],
    [
      "mac-x64",
      "latest-mac.yml",
      ["mac-x64-test.zip", "mac-x64-test.dmg", "mac-x64-test.zip.blockmap"]
    ],
    [
      "linux-x64",
      "latest-linux.yml",
      [
        "linux-x86_64-test.AppImage",
        "linux-amd64-test.deb",
        "linux-x64-test.pkg.tar.xz"
      ]
    ],
    [
      "linux-arm64",
      "latest-linux-arm64.yml",
      [
        "linux-arm64-test.AppImage",
        "linux-arm64-test.deb",
        "linux-aarch64-test.pkg.tar.xz"
      ]
    ]
  ];
  for (const [id, name, suffixes] of groups) {
    const directory = join(input, `installers-${id}`);
    await mkdir(directory, { recursive: true });
    const files = [];
    for (const suffix of suffixes) {
      const url = `DeepWrite-1.2.3-${suffix}`;
      const data = Buffer.from(`invalid-test-artifact:${suffix}`);
      await writeFile(join(directory, url), data);
      if (!suffix.endsWith(".blockmap"))
        files.push({
          url,
          size: data.length,
          sha512: createHash("sha512").update(data).digest("base64")
        });
    }
    await writeFile(
      join(directory, name),
      JSON.stringify({
        version: "1.2.3",
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        releaseDate: "2026-01-01T00:00:00.000Z"
      })
    );
  }
  return { input, output };
}

describe("verified release bundle", () => {
  it("collects every installer and merges both macOS architectures without overwriting manifests", async () => {
    const { input, output } = await fixture();
    const index = await prepareReleaseAssets(input, output, "1.2.3");
    expect(index).toHaveLength(21);
    const mac = yaml.load(
      await readFile(join(output, "latest-mac.yml"), "utf8")
    );
    expect(mac.files.map((file) => file.url)).toEqual([
      "DeepWrite-1.2.3-mac-arm64-test.zip",
      "DeepWrite-1.2.3-mac-arm64-test.dmg",
      "DeepWrite-1.2.3-mac-x64-test.zip",
      "DeepWrite-1.2.3-mac-x64-test.dmg"
    ]);
    expect(
      index.find((file) => file.name === "latest-mac.yml")?.sha256
    ).toMatch(/^[a-f\d]{64}$/u);
  });
  it("rejects missing installers before copying any publishable files", async () => {
    const { input, output } = await fixture();
    await rm(
      join(
        input,
        "installers-linux-x64/DeepWrite-1.2.3-linux-x64-test.pkg.tar.xz"
      )
    );
    await expect(prepareReleaseAssets(input, output, "1.2.3")).rejects.toThrow(
      "Missing release asset"
    );
    expect(await readdir(output)).toEqual([]);
  });
  it.each(["sha512", "size", "version", "path"])(
    "rejects an incorrect manifest %s",
    async (field) => {
      const { input, output } = await fixture();
      const path = join(input, "installers-win-x64/latest.yml");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (field === "sha512") manifest.files[0].sha512 = "invalid-test-digest";
      if (field === "size") manifest.files[0].size++;
      if (field === "version") manifest.version = "1.2.2";
      if (field === "path") manifest.path = "../invalid-test-path";
      await writeFile(path, JSON.stringify(manifest));
      await expect(
        prepareReleaseAssets(input, output, "1.2.3")
      ).rejects.toThrow();
      expect(await readdir(output)).toEqual([]);
    }
  );
  it("refuses unexpected files and stale output", async () => {
    const { input, output } = await fixture();
    const extra = join(input, "installers-win-x64/private-config.json");
    await writeFile(extra, "invalid-test-fixture");
    await expect(prepareReleaseAssets(input, output, "1.2.3")).rejects.toThrow(
      "Unexpected release asset"
    );
    await rm(extra);
    await writeFile(join(output, "stale.exe"), "invalid-test-fixture");
    await expect(prepareReleaseAssets(input, output, "1.2.3")).rejects.toThrow(
      "must be empty"
    );
  });
});
