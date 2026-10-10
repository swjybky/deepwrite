import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type LongMaterialPackOptions
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { appendDecompositionSourceChapters } from "../long-book-decomposition/source-chapters";
import {
  LongMaterialPackService,
  type LongMaterialServiceDeps
} from "./service";

/** A synthetic long book with world, characters, plot and chapter cards. */
export async function longMaterialFixture(chapterCount = 30) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-material-"))
  );
  const userDataPath = join(root, "user-data");
  const workspaceDirectory = join(root, "workspace");
  const longs = new LongWorkspaceService({ userDataPath });
  const catalog = new FolderCatalogStore({ userDataPath });
  await catalog.indexSnapshot();
  const created = await longs.create(join(workspaceDirectory, "books"), {
    title: "铜铃记",
    genre: "玄幻"
  });
  const bookId = created.book.id;
  const { projectDirectory } = await longs.catalog.open(bookId);
  const now = new Date().toISOString();
  await longs.store.transactManaged(projectDirectory, async (loaded) => {
    const { index } = loaded;
    const operations = appendDecompositionSourceChapters(
      index,
      Array.from({ length: chapterCount }, (_, i) => ({
        id: `source_${i + 1}`,
        order: i + 1,
        title: `第${i + 1}章 铃声${i + 1}`,
        volume: i < chapterCount / 2 ? "第一卷 小镇" : "第二卷 宗门",
        sourceName: "fixture.txt",
        text: `第${i + 1}章正文。主角沈砚听见铜铃。`.repeat(20),
        charCount: 400
      })),
      "fixture",
      now
    );
    const cards = new Map(
      index.chapters.map(({ card, chapterCardId }) => [
        card.path,
        chapterCardId
      ])
    );
    for (const operation of operations)
      if (cards.has(operation.path) && "content" in operation)
        operation.content = `## 梗概\n\n沈砚在${cards.get(operation.path)}附近追查铜铃。\n\n## 章末钩子\n\n铃声再响。`;
    const ref = (id: string, path: string) => ({ id, path, updatedAt: now });
    for (const [n, name, group] of [
      [1, "沈砚", "protagonist"],
      [2, "苏婉", "major_supporting"],
      [3, "老周", "minor_supporting"],
      [4, "卖货郎", "passerby"]
    ] as const) {
      const id = `character_fixture${n}`;
      index.characters.push({ id, name, aliases: [], group, order: 1 });
      const files = {
        characterId: id,
        coreProfile: ref(
          longCharacterCoreProfileFileId(id),
          longCharacterFilePath(id, "core-profile.md")
        ),
        relationships: ref(
          longCharacterRelationshipsFileId(id),
          longCharacterFilePath(id, "relationships.md")
        )
      };
      index.characterFiles.push(files);
      operations.push(
        {
          path: files.coreProfile.path,
          content: `${name}的核心档案：性格坚韧。`
        },
        { path: files.relationships.path, content: `${name}与沈砚亦敌亦友。` }
      );
    }
    const categoryId = "world_fixturerealm";
    const itemId = "worlditem_fixture1";
    const realm = {
      id: categoryId,
      title: "铃境",
      order: index.worldbuilding.length + 1,
      format: "list",
      contentAuthority: "files",
      overview: ref(
        longWorldbuildingOverviewFileId(categoryId),
        longWorldbuildingOverviewContentPath(categoryId)
      ),
      items: [
        {
          id: itemId,
          title: "听铃",
          order: 1,
          file: ref(
            longWorldbuildingItemFileId(itemId),
            longWorldbuildingItemContentPath(categoryId, itemId)
          )
        }
      ]
    } as const;
    index.worldbuilding.push({ ...realm, items: [...realm.items] });
    operations.push(
      { path: realm.overview.path, content: "铃境分九层。" },
      { path: realm.items[0].file.path, content: "第一层：听铃。" },
      {
        path: index.bookLine.path,
        content:
          "沈砚从小镇出发追查铜铃的来历。\n\n## 核心梗与卖点\n\n铜铃能听见未来。"
      }
    );
    return { operations, result: undefined };
  });
  const paths = {
    materials: join(workspaceDirectory, "materials"),
    groups: join(workspaceDirectory, "material-groups")
  };
  const service = (progress?: LongMaterialServiceDeps["progress"]) =>
    new LongMaterialPackService({
      workspaceDirectory,
      paths,
      longs,
      catalog,
      ...(progress ? { progress } : {})
    });
  const options: LongMaterialPackOptions = {
    sections: [
      "worldbuilding",
      "characters",
      "plot",
      "chapters",
      "foreshadowing",
      "timeline",
      "style"
    ],
    characterScope: "grouped",
    chapterGrouping: "auto",
    sampleChapterIds: []
  };
  return {
    root,
    workspaceDirectory,
    longs,
    catalog,
    bookId,
    projectDirectory,
    service,
    options,
    paths
  };
}
