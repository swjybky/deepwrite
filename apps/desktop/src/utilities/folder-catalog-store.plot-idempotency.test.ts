import {
  FolderCatalogStore,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  tickingClock
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: idempotent agent plot creation", () => {
  it.each(["short", "script"] as const)(
    "replays one stable %s plot create without duplicating the stage",
    async (bookType) => {
      const root = await makeTemporaryRoot(
        `deepwrite-folder-${bookType}-plot-replay-`
      );
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data"),
        now: tickingClock()
      });
      const opened =
        bookType === "short"
          ? await store.createShortBook(
              { title: "剧情重试短篇", genre: "悬疑" },
              join(root, "books")
            )
          : await store.createScriptBook(
              { title: "剧情重试剧本", genre: "悬疑" },
              join(root, "books")
            );
      const stageId = `plot-stage-agent:${bookType}:stable-1`;
      const request = {
        bookId: opened.resource.id,
        baseProjectRevision: opened.resource.projectRevision ?? 0,
        force: true as const,
        mutation: {
          type: "create" as const,
          stageId,
          title: "终局回收",
          description: "回收所有伏笔。"
        }
      };

      const created = await store.mutatePlotStructure(request);
      const createdRevision = created.projectRevision;
      const replayed = await store.mutatePlotStructure(request);

      expect(replayed.projectRevision).toBe(createdRevision);
      expect(replayed.plotStages.filter(({ id }) => id === stageId)).toEqual([
        expect.objectContaining({
          id: stageId,
          title: "终局回收",
          description: "回收所有伏笔。"
        })
      ]);
      expect(
        replayed.documents.filter(({ id }) => id === stageId)
      ).toHaveLength(1);

      const saved = await store.saveDocument({
        bookId: opened.resource.id,
        documentId: stageId,
        content: "真相在最后一页揭晓。",
        force: true
      });
      const replayedAfterContent = await store.mutatePlotStructure(request);

      expect(replayedAfterContent.projectRevision).toBe(saved.projectRevision);
      expect(
        replayedAfterContent.documents.find(({ id }) => id === stageId)?.content
      ).toBe("真相在最后一页揭晓。");
      expect(
        replayedAfterContent.plotStages.filter(({ id }) => id === stageId)
      ).toHaveLength(1);
      expect(
        (await store.snapshot()).creativePlotStages?.filter(
          ({ id }) => id === stageId
        )
      ).toHaveLength(1);

      await expect(
        store.mutatePlotStructure({
          ...request,
          mutation: {
            ...request.mutation,
            description: "另一个创建意图。"
          }
        })
      ).rejects.toThrow(/已用于其他创建请求/u);
    }
  );
});
