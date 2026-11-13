import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectProjectFiles } from "./catalog-reader";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 20
      })
    )
  );
});

it("excludes local document versions while retaining other project internals", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-backup-versions-"));
  roots.push(root);
  const paths = [
    "deepwrite.json",
    "body.md",
    ".deepwrite/versions/document/index.json",
    ".deepwrite/versions/document/v1-a.md.gz",
    ".deepwrite/restore-points/restore.json",
    "nested/.deepwrite/versions/ordinary.md"
  ];
  for (const path of paths) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (path.includes("/"))
      await mkdir(join(root, parent), { recursive: true });
    await writeFile(join(root, path), "fixture");
  }
  expect(
    (await collectProjectFiles(root)).map((file) => file.relativePath)
  ).toEqual(
    paths
      .filter((path) => !path.startsWith(".deepwrite/versions/"))
      .sort((a, b) => a.localeCompare(b))
  );
});
