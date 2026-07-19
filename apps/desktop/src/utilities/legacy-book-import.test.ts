import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeLegacyBook,
  readLegacyBookArchive
} from "./legacy-book-import";

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

describe("legacy book import", () => {
  it("maps old short stages and retains unsupported text as extra documents", () => {
    const imported = normalizeLegacyBook({
      title: "旧雨夜来信",
      categories: ["现实情感"],
      status: "completed",
      stages: {
        qinggan_character: "人物旧稿",
        plot_design: "剧情旧稿",
        draft: "正文旧稿",
        draft_review: "审阅意见"
      },
      linked_material_id: "material-1",
      linked_skill_ids_by_kind: { style: ["skill-1"] },
      memories: [{ tag: "人物", content: "主角怕水" }]
    });

    expect(imported).toMatchObject({
      title: "旧雨夜来信",
      genre: "追妻",
      status: "completed",
      linkedMaterialIdsByKind: { other: ["material-1"] },
      linkedSkillIdsByKind: { style: ["skill-1"] }
    });
    expect(imported.documents.find(({ id }) => id === "character_design")?.content)
      .toBe("人物旧稿");
    expect(imported.documents.find(({ id }) => id === "draft")?.content)
      .toBe("正文旧稿");
    expect(imported.documents.find(({ title }) => title === "正文审阅（旧版）")?.content)
      .toBe("审阅意见");
    expect(imported.documents.find(({ title }) => title === "书籍记忆（旧版）")?.content)
      .toContain("主角怕水");
  });

  it("reads desktop book.zip packages and falls back to archived stage files", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-legacy-book-zip-"));
    temporaryRoots.push(root);
    const archivePath = join(root, "旧书.zip");
    await writeFile(
      archivePath,
      storedZip({
        "book.json": JSON.stringify({
          title: "压缩包书籍",
          book_type: "short",
          categories: ["悬疑"],
          stages: { outline: "大纲正文" }
        }),
        "stages/draft.txt": "压缩包正文"
      })
    );

    const imported = await readLegacyBookArchive(archivePath);
    expect(imported.genre).toBe("悬疑");
    expect(imported.documents.find(({ id }) => id === "outline")?.content)
      .toBe("大纲正文");
    expect(imported.documents.find(({ id }) => id === "draft")?.content)
      .toBe("压缩包正文");
  });
});
