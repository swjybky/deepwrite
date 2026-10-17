import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateReleaseTag(tag, rootVersion, desktopVersion) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag ?? ""))
    throw new Error("Release tags must use vMAJOR.MINOR.PATCH.");
  const version = tag.slice(1);
  if (rootVersion !== version || desktopVersion !== version)
    throw new Error("The tag must match both package.json versions.");
  return version;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [root, desktop] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../apps/desktop/package.json", import.meta.url), "utf8")
  ]);
  const version = validateReleaseTag(
    process.env.RELEASE_TAG,
    JSON.parse(root).version,
    JSON.parse(desktop).version
  );
  console.log(`RELEASE_TAG_OK version=${version}`);
}
