import {
  FolderCatalogStore,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  writeFile
} from "./folder-catalog-store.test-support";

it("initializes imported same-title stages without losing IDs or existing Markdown", async () => {
  const root = await makeTemporaryRoot("deepwrite-stage-import-");
  const sources = [];
  for (const name of ["a", "b"]) {
    const source = new FolderCatalogStore({ userDataPath: join(root, name) });
    const opened = await source.createShortBook(
      { title: `测试作品 ${name}`, genre: "其他" },
      join(root, "projects")
    );
    const book = await source.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 0,
      mutation: {
        type: "create",
        title: "剧情灵感设计",
        description: "从另一端带来的自定义阶段"
      }
    });
    const stage = book.plotStages.at(-1)!;
    const manifest = JSON.parse(
      await readFile(join(opened.projectDirectory, "deepwrite.json"), "utf8")
    ) as { documents: { id: string; path: string }[] };
    const path = join(
      opened.projectDirectory,
      manifest.documents.find(({ id }) => id === stage.id)!.path
    );
    await writeFile(path, `保留原文 ${name}`, "utf8");
    sources.push({
      ...opened,
      stageId: stage.id,
      path,
      content: `保留原文 ${name}`
    });
  }
  const target = new FolderCatalogStore({ userDataPath: join(root, "target") });
  for (const source of sources)
    await target.openBookProject(source.projectDirectory);
  const index = await target.indexSnapshot();
  expect(index.books).toHaveLength(2);
  expect(
    index.creativePlotStages.filter(({ title }) =>
      title.startsWith("剧情灵感设计")
    )
  ).toHaveLength(2);
  const snapshot = await target.snapshot();
  for (const source of sources) {
    const book = snapshot.books.find(({ id }) => id === source.resource.id)!;
    expect(book.plotStages.map(({ id }) => id)).toEqual(
      expect.arrayContaining(sources.map(({ stageId }) => stageId))
    );
    expect(
      book.documents.find(({ id }) => id === source.stageId)?.content
    ).toBe(source.content);
    expect(await readFile(source.path, "utf8")).toBe(source.content);
    const other = sources.find(({ stageId }) => stageId !== source.stageId)!;
    expect(book.documents.find(({ id }) => id === other.stageId)?.content).toBe(
      ""
    );
  }
  expect((await target.snapshot()).creativePlotStages).toEqual(
    snapshot.creativePlotStages
  );
});
