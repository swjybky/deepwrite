import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const releaseEnvironmentKeys = [
  "MAIN_VITE_DEEPWRITE_APP_MODE",
  "MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL",
  "MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY"
];

export function validateReleaseEnvironment(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("缺少 DEEPWRITE_RELEASE_ENV，拒绝构建缺少配置的安装包。");
  }
  const values = parseEnv(source);
  if (Object.keys(values).some((key) => key.startsWith("MAIN_VITE_OSS_"))) {
    throw new Error(
      "发布配置不得包含 MAIN_VITE_OSS_ 凭据；请迁移到 DeepwriteApi 服务端。"
    );
  }
  const missing = releaseEnvironmentKeys.filter((key) => !values[key]?.trim());
  if (missing.length) {
    throw new Error(`发布配置缺少必填项：${missing.join(", ")}`);
  }
  if (values.MAIN_VITE_DEEPWRITE_APP_MODE.trim() !== "runtime") {
    throw new Error("正式发布的 MAIN_VITE_DEEPWRITE_APP_MODE 必须为 runtime。");
  }
  let url;
  try {
    url = new URL(values.MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL.trim());
  } catch {
    throw new Error("MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL 格式无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL 格式无效。");
  }
  return values;
}

export async function restoreReleaseEnvironment(source, root = process.cwd()) {
  validateReleaseEnvironment(source);
  // Keep dotenv quoting and comments intact; never interpolate the secret in a shell.
  await writeFile(resolve(root, ".env"), source, { mode: 0o600, flag: "wx" });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const action = process.argv[2];
  if (!["check-file", "check-secret", "restore-secret"].includes(action)) {
    throw new Error(
      "Usage: node tools/release-environment.mjs <check-file|check-secret|restore-secret>"
    );
  }
  const source =
    action === "check-file"
      ? await readFile(resolve(".env"), "utf8")
      : process.env.DEEPWRITE_RELEASE_ENV;
  const values = validateReleaseEnvironment(source);
  if (process.env.GITHUB_ACTIONS === "true") {
    // A multiline secret alone does not mask individual embedded field values.
    for (const key of releaseEnvironmentKeys.slice(1)) {
      const escaped = values[key]
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
      console.log(`::add-mask::${escaped}`);
    }
  }
  if (action === "restore-secret") await restoreReleaseEnvironment(source);
  console.log(`RELEASE_ENVIRONMENT_OK keys=${releaseEnvironmentKeys.length}`);
}
