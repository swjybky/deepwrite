import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import aws4 from "aws4";
import { UpdateManifestSchema } from "../packages/contracts/src/update.ts";
import { compareVersions } from "../packages/contracts/src/update-version.ts";
import { inspectReleaseFile } from "./release-files.mjs";
import { cleanupR2Storage, prepareR2Upload } from "./r2-storage.mjs";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);
const immutableCache = "public, max-age=31536000, immutable";
const pointerCache = "no-store";

export function readR2Config(source) {
  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error("缺少或无效的 DEEPWRITE_R2_PUBLISH_CONFIG。");
  }
  if (
    !/^[a-f\d]{32}$/.test(config?.accountId ?? "") ||
    !/^[a-z\d][a-z\d-]{1,61}[a-z\d]$/.test(config?.bucket ?? "") ||
    !config?.accessKeyId ||
    !config?.secretAccessKey
  ) {
    throw new Error("R2 发布配置不完整。");
  }
  let url;
  try {
    url = new URL(config.publicUrl);
  } catch {
    throw new Error("R2 下载地址无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("R2 下载地址必须为不含路径和凭据的 HTTPS 域名。");
  }
  return { ...config, publicUrl: url.origin };
}

export function createR2Client(config, fetcher = fetch) {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  return async (
    method,
    key,
    { body, size, sha256, headers = {}, query } = {}
  ) => {
    const search = query ? `?${new URLSearchParams(query)}` : "";
    const path = `/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}${search}`;
    const signed = aws4.sign(
      {
        host,
        path,
        method,
        service: "s3",
        region: "auto",
        headers: {
          ...headers,
          ...(size !== undefined ? { "content-length": String(size) } : {}),
          "x-amz-content-sha256":
            sha256 ?? createHash("sha256").update("").digest("hex")
        }
      },
      {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    );
    return fetcher(`https://${host}${path}`, {
      method,
      // Compressed GET responses may carry weak ETags, which cannot guard writes.
      headers: { ...signed.headers, "accept-encoding": "identity" },
      body,
      ...(body && typeof body !== "string" ? { duplex: "half" } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(300_000)
    });
  };
}

function matches(response, file) {
  return (
    response.ok &&
    Number(response.headers.get("content-length")) === file.size &&
    response.headers.get("x-amz-meta-sha256") === file.sha256
  );
}

async function inspectRemote(request, key, file) {
  const response = await request("HEAD", key);
  if (response.status === 404) return false;
  if (!matches(response, file))
    throw new Error(`R2 文件校验失败或同名内容冲突：${key}`);
  return true;
}

export async function loadR2Release(directory, manifestPath, tag, publicUrl) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? ""))
    throw new Error("R2 发布标签无效。");
  const manifest = UpdateManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8"))
  );
  if (manifest.version !== tag.slice(1))
    throw new Error("update.json 版本与 R2 发布标签不一致。");
  const files = [];
  for (const name of (await readdir(directory)).sort(
    (a, b) =>
      Number(a.endsWith(".yml")) - Number(b.endsWith(".yml")) ||
      a.localeCompare(b)
  )) {
    files.push({
      name,
      path: join(directory, name),
      ...(await inspectReleaseFile(join(directory, name)))
    });
  }
  const metadata = files.filter((file) => /^latest.*\.yml$/.test(file.name));
  if (!metadata.length) throw new Error("R2 发布目录缺少更新清单。");
  for (const file of metadata) {
    const info = yaml.load(await readFile(file.path, "utf8"));
    if (info?.version !== manifest.version || !info.files?.length)
      throw new Error("R2 更新清单版本或文件列表无效。");
    for (const entry of info.files) {
      const artifact = files.find((candidate) => candidate.name === entry.url);
      if (
        !artifact ||
        artifact.sha512 !== entry.sha512 ||
        artifact.size !== entry.size
      )
        throw new Error("R2 更新清单引用的文件或校验值不匹配。");
    }
  }
  const prefix = `releases/${tag}`;
  return {
    files,
    prefix,
    manifest: { ...manifest, feedUrl: `${publicUrl}/${prefix}` }
  };
}

export async function uploadR2Release(request, release) {
  await prepareR2Upload(request, release);
  for (const file of release.files) {
    const key = `${release.prefix}/${file.name}`;
    if (await inspectRemote(request, key, file)) continue;
    const response = await request("PUT", key, {
      body: createReadStream(file.path),
      size: file.size,
      sha256: file.sha256,
      headers: {
        "if-none-match": "*",
        "cache-control": immutableCache,
        "content-type": file.name.endsWith(".yml")
          ? "text/yaml"
          : "application/octet-stream",
        "x-amz-meta-sha256": file.sha256
      }
    });
    if (!response.ok && response.status !== 412)
      throw new Error(
        `R2 文件上传失败（HTTP ${response.status}）：${file.name}`
      );
    if (!(await inspectRemote(request, key, file)))
      throw new Error(`R2 文件上传后不存在：${file.name}`);
  }
}

export async function activateR2Release(request, release) {
  for (const file of release.files) {
    if (!(await inspectRemote(request, `${release.prefix}/${file.name}`, file)))
      throw new Error("R2 安装包尚未全部上传，拒绝更新版本指针。");
  }
  const current = await request("GET", "update.json");
  let condition = { "if-none-match": "*" };
  if (current.ok) {
    const previous = UpdateManifestSchema.parse(await current.json());
    if (compareVersions(previous.version, release.manifest.version) > 0)
      return false;
    const etag = current.headers.get("etag");
    if (!etag) throw new Error("R2 当前版本指针缺少 ETag，拒绝覆盖。");
    condition = { "if-match": etag };
  } else if (current.status !== 404)
    throw new Error(`读取 R2 当前版本失败（HTTP ${current.status}）。`);
  const body = JSON.stringify(release.manifest, null, 2) + "\n";
  const response = await request("PUT", "update.json", {
    body,
    size: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
    headers: {
      ...condition,
      "content-type": "application/json",
      "cache-control": pointerCache
    }
  });
  if (!response.ok)
    throw new Error(
      `更新 R2 版本指针失败（HTTP ${response.status}）；可重跑激活步骤。`
    );
  const storage = await cleanupR2Storage(request);
  console.log(
    `R2_STORAGE_OK bytes=${storage.bytes} deleted=${storage.deleted}`
  );
  return true;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [action, directory, manifestPath] = process.argv.slice(2);
  if (!["upload", "activate"].includes(action) || !directory || !manifestPath)
    throw new Error(
      "Usage: node tools/publish-r2-release.mjs <upload|activate> <directory> <update.json>"
    );
  const config = readR2Config(process.env.DEEPWRITE_R2_PUBLISH_CONFIG);
  const release = await loadR2Release(
    resolve(directory),
    resolve(manifestPath),
    process.env.RELEASE_TAG,
    config.publicUrl
  );
  const request = createR2Client(config);
  if (action === "upload") await uploadR2Release(request, release);
  else await activateR2Release(request, release);
  console.log(
    `R2_RELEASE_${action.toUpperCase()}_OK files=${release.files.length}`
  );
}
