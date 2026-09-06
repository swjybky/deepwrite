import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  tickingClock
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: external library import", () => {
  it("imports a material batch atomically with default stages and unique titles", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-import-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createLibrary({
      domain: "material",
      name: "剧情素材",
      materialKind: "plot",
      parentDirectory: join(root, "libraries")
    });
    await store.createLibraryEntry({
      domain: "material",
      libraryId: opened.resource.id,
      title: "雨夜",
      content: "原内容",
      stageId: "pacing",
      baseProjectRevision: 0
    });

    const result = await store.importLibraryEntries({
      domain: "material",
      libraryId: opened.resource.id,
      baseProjectRevision: 1,
      entries: [
        { title: "雨夜", content: "新内容一" },
        { title: "雨夜", content: "新内容二" }
      ]
    });

    expect(
      result.entries.map(({ title, stageId, body }) => ({
        title,
        stageId,
        body
      }))
    ).toEqual([
      { title: "雨夜 (2)", stageId: "pacing", body: "新内容一" },
      { title: "雨夜 (3)", stageId: "pacing", body: "新内容二" }
    ]);
    const library = (await store.snapshot()).materials.find(
      ({ id }) => id === opened.resource.id
    );
    expect(library?.projectRevision).toBe(2);
    expect(library?.entries).toHaveLength(3);
  });

  it("rejects stale revisions without creating part of the batch", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-import-conflict-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createLibrary({
      domain: "skill",
      name: "通用技能",
      skillKind: "general",
      parentDirectory: join(root, "libraries")
    });

    await expect(
      store.importLibraryEntries({
        domain: "skill",
        libraryId: opened.resource.id,
        baseProjectRevision: 1,
        entries: [
          { title: "检查一", content: "正文一" },
          { title: "检查二", content: "正文二" }
        ]
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(
      (await store.snapshot()).skills.find(
        ({ id }) => id === opened.resource.id
      )?.entries
    ).toEqual([]);
  });

  it("validates every body before starting a multi-file commit", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-import-size-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock(),
      maxMarkdownBytes: 8
    });
    const opened = await store.createLibrary({
      domain: "skill",
      name: "容量技能",
      skillKind: "general",
      parentDirectory: join(root, "libraries")
    });

    await expect(
      store.importLibraryEntries({
        domain: "skill",
        libraryId: opened.resource.id,
        baseProjectRevision: 0,
        entries: [
          { title: "短内容", content: "ok" },
          { title: "超限内容", content: "too-long-content" }
        ]
      })
    ).rejects.toThrow("byte limit");
    expect(
      (await store.snapshot()).skills.find(
        ({ id }) => id === opened.resource.id
      )?.entries
    ).toEqual([]);
  });
});
