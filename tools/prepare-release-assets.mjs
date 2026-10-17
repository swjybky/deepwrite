import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateReleaseTag } from "./validate-release-tag.mjs";

const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const builderRequire = createRequire(require.resolve("electron-builder"));
const yaml = createRequire(builderRequire.resolve("app-builder-lib"))(
  "js-yaml"
);

export async function fileHash(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(algorithm === "sha512" ? "base64" : "hex");
}

function layout(version) {
  const prefix = `DeepWrite-${version}-`;
  return [
    {
      id: "win-x64",
      manifest: "latest.yml",
      required: [
        `${prefix}win-x64-test.exe`,
        `${prefix}win-x64-test.exe.blockmap`
      ]
    },
    ...["arm64", "x64"].map((arch) => ({
      id: `mac-${arch}`,
      manifest: "latest-mac.yml",
      required: [
        `${prefix}mac-${arch}-test.dmg`,
        `${prefix}mac-${arch}-test.zip`,
        `${prefix}mac-${arch}-test.zip.blockmap`
      ]
    })),
    {
      id: "linux-x64",
      manifest: "latest-linux.yml",
      required: [
        `${prefix}linux-x86_64-test.AppImage`,
        `${prefix}linux-amd64-test.deb`,
        `${prefix}linux-x64-test.pkg.tar.xz`
      ]
    }
  ];
}

async function readManifest(path, version, assets) {
  const manifest = yaml.load(await readFile(path, "utf8"));
  if (
    manifest?.version !== version ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error(`Invalid update manifest: ${basename(path)}`);
  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      typeof entry.url !== "string" ||
      basename(entry.url) !== entry.url ||
      entry.url.includes("\\") ||
      seen.has(entry.url)
    )
      throw new Error(
        "Update manifest contains an invalid or duplicate asset name."
      );
    seen.add(entry.url);
    const asset = assets.get(entry.url);
    if (!asset || entry.size !== asset.size || entry.sha512 !== asset.sha512)
      throw new Error(
        `Update manifest checksum or size mismatch: ${entry.url}`
      );
  }
  const primary = assets.get(manifest.path);
  if (
    !primary ||
    !seen.has(manifest.path) ||
    manifest.sha512 !== primary.sha512
  )
    throw new Error("Update manifest primary asset is invalid.");
  return manifest;
}

export async function prepareReleaseAssets(input, output, version) {
  validateReleaseTag(`v${version}`, version, version);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length)
    throw new Error("Release output directory must be empty.");
  const assets = new Map();
  const manifests = new Map();
  for (const group of layout(version)) {
    const directory = join(input, `installers-${group.id}`);
    const names = await readdir(directory);
    for (const required of [...group.required, group.manifest]) {
      if (!names.includes(required))
        throw new Error(`Missing release asset: ${required}`);
    }
    for (const name of names) {
      if (name === group.manifest) continue;
      if (
        !group.required.includes(name) &&
        !group.required.some(
          (required) =>
            !required.endsWith(".blockmap") && name === `${required}.blockmap`
        )
      )
        throw new Error(`Unexpected release asset: ${name}`);
      const path = join(directory, name);
      const info = await stat(path);
      if (!info.isFile() || !info.size || assets.has(name))
        throw new Error(`Invalid or duplicate release asset: ${name}`);
      assets.set(name, {
        name,
        size: info.size,
        sha512: await fileHash(path, "sha512"),
        sha256: await fileHash(path, "sha256"),
        path
      });
    }
    const manifest = await readManifest(
      join(directory, group.manifest),
      version,
      new Map(
        names
          .filter((name) => assets.has(name))
          .map((name) => [name, assets.get(name)])
      )
    );
    const expected = group.id.startsWith("mac-")
      ? group.required[1]
      : group.required[0];
    if (!manifest.files.some((file) => file.url === expected))
      throw new Error(`Update manifest omits ${expected}`);
    const previous = manifests.get(group.manifest);
    if (previous) {
      const files = [...previous.files, ...manifest.files];
      if (new Set(files.map((file) => file.url)).size !== files.length)
        throw new Error("Duplicate macOS update assets.");
      manifests.set(group.manifest, { ...previous, files });
    } else manifests.set(group.manifest, manifest);
  }
  for (const asset of assets.values())
    await copyFile(asset.path, join(output, asset.name));
  for (const [name, manifest] of manifests)
    await writeFile(join(output, name), yaml.dump(manifest, { lineWidth: -1 }));
  const index = [];
  for (const name of (await readdir(output)).sort()) {
    const path = join(output, name);
    index.push({
      name,
      size: (await stat(path)).size,
      sha256: await fileHash(path, "sha256")
    });
  }
  await writeFile(
    join(output, "assets.json"),
    `${JSON.stringify(index, null, 2)}\n`
  );
  return index;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const index = await prepareReleaseAssets(
    resolve(process.argv[2]),
    resolve(process.argv[3]),
    process.env.RELEASE_TAG?.slice(1)
  );
  console.log(`RELEASE_ASSETS_OK count=${index.length}`);
}
