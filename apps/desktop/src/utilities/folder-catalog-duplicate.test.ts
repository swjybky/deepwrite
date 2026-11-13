import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultCreativePlotStages,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";

const NOW = "2026-08-05T08:00:00.000Z";
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-catalog-copy-"));
  roots.push(root);
  return root;
}

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

describe("FolderCatalogStore duplicateProject", () => {
  it("copies book images and skips symbolic links without sharing file bytes", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const source = await store.createShortBook({
      title: "插图原稿",
      genre: "悬疑"
    });
    const images = join(source.projectDirectory, "images");
    await mkdir(images);
    const bytes = Buffer.from("illustration bytes");
    await writeFile(join(images, "地图.png"), bytes);
    if (process.platform !== "win32")
      await symlink(join(images, "地图.png"), join(images, "链接.png"));
    const duplicated = await store.duplicateProject({
      domain: "book",
      projectId: source.resource.id
    });
    const target = join(
      await store.projectDirectory(duplicated.projectId),
      "images"
    );
    expect(await readFile(join(target, "地图.png"))).toEqual(bytes);
    expect((await lstat(join(target, "地图.png"))).isSymbolicLink()).toBe(
      false
    );
    expect(await readdir(target)).toEqual(["地图.png"]);
    await writeFile(join(images, "地图.png"), "changed source");
    expect(await readFile(join(target, "地图.png"))).toEqual(bytes);
  });

  it("rolls back a book copy when its image directory is invalid", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const source = await store.createShortBook({
      title: "损坏插图",
      genre: "悬疑"
    });
    await writeFile(join(source.projectDirectory, "images"), "not a directory");
    const parent = join(source.projectDirectory, "..");
    const before = await readdir(parent);
    await expect(
      store.duplicateProject({ domain: "book", projectId: source.resource.id })
    ).rejects.toThrow("images");
    expect(await readdir(parent)).toEqual(before);
    expect((await store.snapshot()).books).toHaveLength(1);
  });

  it("duplicates short books with content, bindings, structure and copyN names", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const material = await store.createLibrary({
      domain: "material",
      name: "人物素材",
      materialKind: "character"
    });
    const skill = await store.createLibrary({
      domain: "skill",
      name: "剧情技能",
      skillKind: "plot"
    });
    const created = await store.createShortBook({
      title: "雨夜",
      genre: "悬疑",
      linkedMaterialIdsByKind: { character: [material.resource.id] },
      linkedSkillIdsByKind: { plot: [skill.resource.id] }
    });
    await store.saveDocument({
      bookId: created.resource.id,
      documentId: "plot_design",
      content: "完整剧情设计",
      force: true
    });

    const first = await store.duplicateProject({
      domain: "book",
      projectId: created.resource.id
    });
    const second = await store.duplicateProject({
      domain: "book",
      projectId: created.resource.id
    });
    const third = await store.duplicateProject({
      domain: "book",
      projectId: first.projectId
    });
    const snapshot = await store.snapshot();
    const source = snapshot.books.find(({ id }) => id === created.resource.id)!;
    const copy = snapshot.books.find(({ id }) => id === first.projectId)!;

    expect([first.title, second.title, third.title]).toEqual([
      "雨夜copy1",
      "雨夜copy2",
      "雨夜copy3"
    ]);
    expect(copy.id).not.toBe(source.id);
    expect(copy.bookType).toBe(source.bookType);
    expect(copy.genre).toBe(source.genre);
    expect(copy.characterStructure).toEqual(source.characterStructure);
    expect(copy.plotStages).toEqual(source.plotStages);
    expect(copy.linkedMaterialIdsByKind).toEqual(
      source.linkedMaterialIdsByKind
    );
    expect(copy.linkedSkillIdsByKind).toEqual(source.linkedSkillIdsByKind);
    expect(copy.documents).toEqual(source.documents);
    expect(copy.draft).toEqual(source.draft);
  });

  it("deep-copies group member libraries and their entries", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: () => NOW
    });
    const character = await store.createLibrary({
      domain: "material",
      name: "人物仓库",
      materialKind: "character"
    });
    const gimmick = await store.createLibrary({
      domain: "material",
      name: "梗仓库",
      materialKind: "gimmick"
    });
    await store.createLibraryEntry({
      domain: "material",
      libraryId: character.resource.id,
      title: "女主",
      content: "独立人物内容",
      stageId: "character",
      force: true
    });
    const group = await store.createLibraryGroup({
      domain: "material",
      name: "都市组",
      members: {
        character: character.resource.id,
        gimmick: gimmick.resource.id
      }
    });

    const result = await store.duplicateProject({
      domain: "material-group",
      projectId: group.resource.id
    });
    const snapshot = await store.snapshot();
    const copiedGroup = snapshot.materialGroups.find(
      ({ id }) => id === result.projectId
    )!;
    const copiedCharacter = snapshot.materials.find(
      ({ id }) => id === copiedGroup.members.character
    )!;
    const copiedGimmick = snapshot.materials.find(
      ({ id }) => id === copiedGroup.members.gimmick
    )!;

    expect(copiedGroup.title).toBe("都市组copy1");
    expect(result.copiedMemberLibraryIds).toHaveLength(2);
    expect(copiedCharacter).toMatchObject({
      title: "人物仓库copy1",
      entries: [{ title: "女主", body: "独立人物内容" }]
    });
    expect(copiedGimmick.title).toBe("梗仓库copy1");
    expect(copiedCharacter.id).not.toBe(character.resource.id);
    expect(copiedGimmick.id).not.toBe(gimmick.resource.id);
  });

  it("turns an official skill library copy into an editable personal library", async () => {
    const root = await temporaryRoot();
    const initial: CatalogSnapshot = {
      schemaVersion: 1,
      revision: 0,
      creativePlotStages: createDefaultCreativePlotStages(),
      books: [],
      materials: [],
      materialGroups: [],
      skills: [
        {
          id: "official-skill",
          title: "官方方法",
          skillType: "short",
          skillKind: "general",
          overview: "官方说明",
          isBuiltin: true,
          entries: [
            {
              id: "official-entry",
              stageId: "draft",
              title: "方法一",
              body: "官方正文",
              createdAt: NOW,
              updatedAt: NOW
            }
          ],
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      skillGroups: [],
      updatedAt: NOW
    };
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      initialSnapshot: initial,
      now: () => NOW
    });

    const result = await store.duplicateProject({
      domain: "skill",
      projectId: "official-skill"
    });
    const copy = (await store.snapshot()).skills.find(
      ({ id }) => id === result.projectId
    )!;
    expect(copy).toMatchObject({
      title: "官方方法copy1",
      isBuiltin: false,
      overview: "官方说明",
      entries: [{ title: "方法一", body: "官方正文" }]
    });
  });

  it("rejects a group with an unreadable member before creating partial copies", async () => {
    const root = await temporaryRoot();
    const initial: CatalogSnapshot = {
      schemaVersion: 1,
      revision: 0,
      creativePlotStages: createDefaultCreativePlotStages(),
      books: [],
      materials: [],
      materialGroups: [
        {
          id: "broken-group",
          title: "损坏组",
          members: { character: "missing-library" },
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      skills: [],
      skillGroups: [],
      updatedAt: NOW
    };
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      initialSnapshot: initial,
      now: () => NOW
    });

    await expect(
      store.duplicateProject({
        domain: "material-group",
        projectId: "broken-group"
      })
    ).rejects.toThrow(/不存在或不可读取/u);
    const snapshot = await store.snapshot();
    expect(snapshot.materials).toEqual([]);
    expect(snapshot.materialGroups.map(({ id }) => id)).toEqual([
      "broken-group"
    ]);
  });
});
