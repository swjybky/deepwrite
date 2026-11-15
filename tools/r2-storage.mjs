import { DOMParser } from "@xmldom/xmldom";
import { UpdateManifestSchema } from "../packages/contracts/src/update.ts";
import { compareVersions } from "../packages/contracts/src/update-version.ts";

export const R2_STORAGE_LIMIT = 10_000_000_000;
const releaseKey =
  /^releases\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/.+$/;

export async function readR2Pointer(request) {
  const response = await request("GET", "update.json");
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`读取 R2 当前版本失败（HTTP ${response.status}）。`);
  const manifest = UpdateManifestSchema.parse(await response.json());
  const etag = response.headers.get("etag");
  if (!etag) throw new Error("R2 当前版本指针缺少 ETag，拒绝清理。");
  return { manifest, etag, prefix: `releases/v${manifest.version}/` };
}

export async function listR2Objects(request) {
  const objects = [];
  const tokens = new Set();
  const keys = new Set();
  let token;
  do {
    const query = {
      "list-type": "2",
      "encoding-type": "url",
      ...(token ? { "continuation-token": token } : {})
    };
    const response = await request("GET", "", { query });
    if (!response.ok)
      throw new Error(`列出 R2 文件失败（HTTP ${response.status}）。`);
    const document = new DOMParser({
      onError() {
        throw new Error("R2 文件列表 XML 无效。");
      }
    }).parseFromString(await response.text(), "application/xml");
    const root = document.documentElement;
    const value = (node, name) => {
      const values = node.getElementsByTagName(name);
      if (values.length !== 1) throw new Error("R2 文件列表字段无效。");
      return values[0].textContent;
    };
    if (
      root.tagName !== "ListBucketResult" ||
      value(root, "EncodingType") !== "url"
    )
      throw new Error("R2 文件列表格式无效。");
    for (const node of root.getElementsByTagName("Contents")) {
      const key = decodeURIComponent(value(node, "Key"));
      const rawSize = value(node, "Size");
      const size = Number(rawSize);
      if (
        !key ||
        keys.has(key) ||
        !/^\d+$/.test(rawSize) ||
        !Number.isSafeInteger(size)
      )
        throw new Error("R2 文件列表的路径或大小无效。");
      keys.add(key);
      objects.push({ key, size });
    }
    const truncated = value(root, "IsTruncated");
    if (!["true", "false"].includes(truncated))
      throw new Error("R2 文件列表分页状态无效。");
    token = truncated === "true" ? value(root, "NextContinuationToken") : null;
    if (token !== null) {
      if (!token || tokens.has(token))
        throw new Error("R2 文件列表分页游标无效。");
      tokens.add(token);
    }
  } while (token);
  return objects;
}

function checkLimit(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes > R2_STORAGE_LIMIT)
    throw new Error(`R2 存储将达到 ${bytes} 字节，超过 10 GB，已停止上传。`);
}

async function removeOtherReleases(request, objects, pointer, keep) {
  const obsolete = objects.filter(
    ({ key }) =>
      releaseKey.test(key) &&
      !key.split("/").some((part) => part === "." || part === "..") &&
      !keep.some((p) => key.startsWith(p))
  );
  if (obsolete.length) {
    const latest = await readR2Pointer(request);
    if (latest?.etag !== pointer?.etag)
      throw new Error("R2 当前版本已改变，停止清理，请重跑同步。");
  }
  for (const { key } of obsolete) {
    const response = await request("DELETE", key);
    if (!response.ok)
      throw new Error(`R2 旧版本清理失败（HTTP ${response.status}）：${key}`);
  }
  return obsolete.length;
}

export async function prepareR2Upload(request, release) {
  const pointer = await readR2Pointer(request);
  if (
    pointer &&
    compareVersions(pointer.manifest.version, release.manifest.version) > 0
  )
    throw new Error("R2 已有更新版本，拒绝上传旧版本。");
  const keep = [release.prefix + "/", ...(pointer ? [pointer.prefix] : [])];
  let objects = await listR2Objects(request);
  if (await removeOtherReleases(request, objects, pointer, keep))
    objects = await listR2Objects(request);
  const existing = new Map(objects.map((object) => [object.key, object.size]));
  const manifestSize = Buffer.byteLength(
    JSON.stringify(release.manifest, null, 2) + "\n"
  );
  const projected =
    objects.reduce((bytes, object) => bytes + object.size, 0) +
    release.files.reduce(
      (bytes, file) =>
        bytes +
        (existing.has(`${release.prefix}/${file.name}`) ? 0 : file.size),
      0
    ) +
    Math.max(0, manifestSize - (existing.get("update.json") ?? 0));
  checkLimit(projected);
  return projected;
}

export async function cleanupR2Storage(request) {
  const pointer = await readR2Pointer(request);
  if (!pointer) throw new Error("R2 尚无当前版本指针，拒绝清理。");
  const objects = await listR2Objects(request);
  const deleted = await removeOtherReleases(request, objects, pointer, [
    pointer.prefix
  ]);
  const remaining = deleted ? await listR2Objects(request) : objects;
  const bytes = remaining.reduce((sum, object) => sum + object.size, 0);
  checkLimit(bytes);
  return { deleted, objects: remaining.length, bytes };
}
