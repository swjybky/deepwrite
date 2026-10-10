import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLibraryPackageFiles,
  recognizeLibraryPackage,
  resolveLibraryPackageImport,
  type MaterialLibrary
} from "@deepwrite/contracts";

vi.mock("electron", () => ({}));

import { scanLibraryPackageSource } from "../utilities/library-package/scan-source";
import { availableArchivePath, writeArchive } from "./library-package-export";
import { createZip } from "./zip-writer";

const NOW = "2026-10-09T08:00:00.000Z";
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-library-package-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const library: MaterialLibrary = {
  id: "material-1",
  title: "都市剧情",
  materialType: "long",
  materialKind: "plot",
  parentGenre: "都市",
  subGenre: "",
  overview: "简介",
  entries: [
    ["pacing", "退婚开局", "第一幕"],
    ["plot_refine", "反转/细化", "第二幕"],
    ["pacing", "空白", ""]
  ].map(([stageId, title, body], index) => ({
    id: `e${index}`,
    stageId: stageId as MaterialLibrary["entries"][number]["stageId"],
    title: title!,
    body: body!,
    createdAt: NOW,
    updatedAt: NOW
  })),
  createdAt: NOW,
  updatedAt: NOW
};

describe("library package ZIP", () => {
  it("round-trips through a real archive on disk", async () => {
    const root = await temporaryRoot();
    const layout = buildLibraryPackageFiles(
      {
        domain: "material",
        groupTitle: null,
        members: [{ slot: null, library }]
      },
      { locale: "zh-CN", generator: "DeepWrite test", exportedAt: NOW }
    );
    const path = await availableArchivePath(root, layout.rootName);
    await writeArchive(
      path,
      createZip(
        layout.files.map(({ path: name, content }) => ({
          name,
          data: Buffer.from(content, "utf8")
        }))
      )
    );
    expect(await readdir(root)).toEqual(["都市剧情.zip"]);

    const scanned = await scanLibraryPackageSource(path, "zip");
    expect(scanned.tree.files.map(({ path: file }) => file)).toContain(
      "都市剧情/剧情细化/01 反转 细化.md"
    );
    const resolved = resolveLibraryPackageImport(
      recognizeLibraryPackage(scanned.tree, "material"),
      {
        libraries: [{ key: "lib-1", include: true, title: "都市剧情" }],
        createGroup: false
      }
    );
    expect(resolved.libraries[0]).toMatchObject({
      title: "都市剧情",
      kind: "plot",
      libraryType: "long",
      overview: "简介",
      entries: library.entries.map(({ title, stageId, body }) => ({
        title,
        stageId,
        content: body
      }))
    });
  });

  it("never replaces an existing archive", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "人设.zip"), "old");
    await writeFile(join(root, "人设 (2).zip"), "old");
    expect(await availableArchivePath(root, "人设")).toBe(
      join(root, "人设 (3).zip")
    );
  });
});
