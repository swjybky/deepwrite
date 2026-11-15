import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { UpdateManifestSchema } from "../packages/contracts/src/update.ts";
import { inspectReleaseFile } from "./release-files.mjs";

export function resolvePublishedTag(manifest, requested) {
  const value = UpdateManifestSchema.parse(manifest);
  const tag = requested || `v${value.version}`;
  if (tag !== `v${value.version}` || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("同步标签必须与正式发布的 update.json 版本一致。");
  }
  return tag;
}

export async function downloadReleaseAssets({
  repository,
  tag,
  directory,
  token,
  fetcher = fetch
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^v\d+\.\d+\.\d+$/.test(tag ?? "")
  )
    throw new Error("发布仓库或版本标签无效。");
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(30_000)
    }
  );
  if (!response.ok)
    throw new Error(`读取公开 Release 失败（HTTP ${response.status}）。`);
  const release = await response.json();
  if (
    release.draft ||
    release.prerelease ||
    release.tag_name !== tag ||
    !release.assets?.length
  )
    throw new Error("只能同步已有附件的正式公开 Release。");
  const seen = new Set();
  for (const asset of release.assets) {
    const url = new URL(asset.browser_download_url);
    if (
      !/^[\w.-]+$/.test(asset.name) ||
      seen.has(asset.name) ||
      !/^sha256:[a-f\d]{64}$/.test(asset.digest ?? "") ||
      asset.size <= 0 ||
      asset.state !== "uploaded" ||
      url.origin !== "https://github.com" ||
      !url.pathname.startsWith(`/${repository}/releases/download/${tag}/`)
    )
      throw new Error("Release 附件路径、状态或校验值无效。");
    seen.add(asset.name);
  }
  await mkdir(directory, { recursive: true });
  for (const asset of release.assets) {
    const response = await fetcher(asset.browser_download_url, {
      signal: AbortSignal.timeout(300_000)
    });
    if (!response.ok || !response.body)
      throw new Error(`下载 Release 附件失败（HTTP ${response.status}）。`);
    const path = join(directory, asset.name);
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(path, { flags: "wx" })
    );
    const file = await inspectReleaseFile(path);
    if (file.size !== asset.size || `sha256:${file.sha256}` !== asset.digest)
      throw new Error(`Release 附件下载校验失败：${asset.name}`);
  }
  return release.assets.length;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [tag, directory] = process.argv.slice(2);
  if (!directory)
    throw new Error(
      "Usage: node tools/download-release-assets.mjs <tag> <directory>"
    );
  const count = await downloadReleaseAssets({
    repository: process.env.GITHUB_REPOSITORY,
    tag,
    directory: resolve(directory),
    token: process.env.GH_TOKEN
  });
  console.log(`RELEASE_DOWNLOAD_OK files=${count}`);
}
