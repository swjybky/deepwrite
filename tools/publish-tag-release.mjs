import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

/** Only the write-scoped release job receives this client; builds remain read-only. */
export async function publishTagRelease({ github, context, directory, tag }) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag ?? ""))
    throw new Error("Invalid release tag.");
  const index = JSON.parse(
    await readFile(join(directory, "assets.json"), "utf8")
  );
  if (
    !Array.isArray(index) ||
    !index.length ||
    new Set(index.map((file) => file.name)).size !== index.length
  )
    throw new Error("Invalid verified release asset index.");
  for (const file of index) {
    if (
      typeof file.name !== "string" ||
      basename(file.name) !== file.name ||
      file.name.includes("\\") ||
      !/^(DeepWrite-|latest(?:-mac|-linux)?(?:-arm64)?\.yml$)/u.test(
        file.name
      ) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      !/^[a-f\d]{64}$/u.test(file.sha256)
    )
      throw new Error("Invalid verified release asset.");
  }
  const marker = `<!-- deepwrite-tag-build:${context.runId} -->`;
  const repo = context.repo;
  let release;
  try {
    release = (await github.rest.repos.getReleaseByTag({ ...repo, tag })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (release && (!release.draft || !release.body?.includes(marker)))
    throw new Error(
      "The tag already has a published release or a draft owned by another run."
    );
  if (!release) {
    release = (
      await github.rest.repos.createRelease({
        ...repo,
        tag_name: tag,
        target_commitish: context.sha,
        name: `DeepWrite ${tag.slice(1)}`,
        draft: true,
        prerelease: false,
        generate_release_notes: true,
        body: marker
      })
    ).data;
  }
  const params = { ...repo, release_id: release.id };
  let existing = await github.paginate(
    github.rest.repos.listReleaseAssets,
    params
  );
  if (existing.some((asset) => !index.some((file) => file.name === asset.name)))
    throw new Error("The draft contains unexpected assets.");
  for (const file of index) {
    const data = await readFile(join(directory, file.name));
    const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
    if (data.length !== file.size || digest !== `sha256:${file.sha256}`)
      throw new Error(`Release asset changed after validation: ${file.name}`);
    const previous = existing.find((asset) => asset.name === file.name);
    if (
      previous?.state === "uploaded" &&
      previous.size === file.size &&
      previous.digest === digest
    )
      continue;
    if (previous)
      await github.rest.repos.deleteReleaseAsset({
        ...repo,
        asset_id: previous.id
      });
    await github.rest.repos.uploadReleaseAsset({
      ...params,
      name: file.name,
      data,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": file.size
      }
    });
  }
  existing = await github.paginate(github.rest.repos.listReleaseAssets, params);
  if (
    existing.length !== index.length ||
    index.some(
      (file) =>
        !existing.some(
          (asset) =>
            asset.name === file.name &&
            asset.state === "uploaded" &&
            asset.size === file.size &&
            (!asset.digest || asset.digest === `sha256:${file.sha256}`)
        )
    )
  )
    throw new Error(
      "Uploaded release assets do not match the verified bundle."
    );
  const published = (
    await github.rest.repos.updateRelease({
      ...params,
      draft: false,
      prerelease: false,
      make_latest: "true"
    })
  ).data;
  if (published.draft || published.prerelease || published.tag_name !== tag)
    throw new Error("Release did not become public.");
  return published.html_url;
}
