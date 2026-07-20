import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyLibraryArchive } from "./legacy-library-import";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function storedZip(files: Readonly<Record<string, string>>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const content = Buffer.from(text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function writeLegacyPackage(
  libraryType: "material" | "skill",
  data: Record<string, unknown>
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-legacy-library-"));
  temporaryRoots.push(root);
  const archivePath = join(root, `${libraryType}.zip`);
  await writeFile(
    archivePath,
    storedZip({
      "metadata.json": JSON.stringify({
        library_type: libraryType,
        data,
        app: "write-claw-mobile",
        schemaVersion: 1
      })
    })
  );
  return archivePath;
}

describe("legacy library import", () => {
  it("reads a legacy material package and retains stage entries", async () => {
    const archivePath = await writeLegacyPackage("material", {
      id: "old-material",
      title: "旧版追妻素材",
      material_type: "short",
      material_kind: "character",
      parent_genre: "现实情感",
      sub_genre: "剧情流追妻",
      overview: "旧版素材说明",
      stage_items: {
        character: [
          { id: "old-entry", title: "冷面男主", body: "他从不解释。" }
        ]
      },
      stages: { draft_excerpt: "雨夜正文片段" }
    });

    const imported = await readLegacyLibraryArchive(archivePath, "material");
    expect(imported).toMatchObject({
      domain: "material",
      library: {
        title: "旧版追妻素材",
        materialType: "short",
        materialKind: "character",
        parentGenre: "追妻",
        subGenre: "剧情流追妻",
        overview: "旧版素材说明"
      }
    });
    expect(imported.library.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "character",
          title: "冷面男主",
          body: "他从不解释。"
        }),
        expect.objectContaining({
          stageId: "draft_excerpt",
          body: "雨夜正文片段"
        })
      ])
    );
  });

  it("maps legacy skill stage aliases and rejects a mismatched package", async () => {
    const archivePath = await writeLegacyPackage("skill", {
      id: "old-skill",
      title: "旧版剧情技能",
      skill_type: "short",
      skill_kind: "plot",
      is_builtin: true,
      overview: "旧版技能说明",
      stages: {
        intro_design: [{ title: "导语钩子", body: "开头先制造悬念。" }],
        draft_review: "检查每一段是否推进冲突。"
      }
    });

    const imported = await readLegacyLibraryArchive(archivePath, "skill");
    expect(imported).toMatchObject({
      domain: "skill",
      library: {
        title: "旧版剧情技能",
        skillType: "short",
        skillKind: "plot",
        isBuiltin: false
      }
    });
    expect(imported.library.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "plot_design",
          title: "导语钩子",
          body: "开头先制造悬念。"
        }),
        expect.objectContaining({
          stageId: "draft",
          body: "检查每一段是否推进冲突。"
        })
      ])
    );
    await expect(
      readLegacyLibraryArchive(archivePath, "material")
    ).rejects.toThrow(/不能作为素材库导入/u);
  });
});
