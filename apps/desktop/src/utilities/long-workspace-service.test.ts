import {
  mkdtemp,
  readFile,
  realpath,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyLongMarkdownFileReference,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingContentPath,
  longWorldbuildingFileId
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "./long-workspace-service";

describe("LongWorkspaceService", () => {
  it("renames a long book and refreshes its catalog summary", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-rename-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "旧名称",
      genre: "科幻"
    });
    const renamed = await service.renameBook({
      bookId: created.book.id,
      title: "新名称"
    });

    expect(renamed.summary.title).toBe("新名称");
    expect((await service.list()).books[0]?.title).toBe("新名称");
  });

  it("updates long bindings independently from the short/script Catalog", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-bindings-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "资源清单",
      genre: "科幻"
    });
    const updated = await service.updateBindings({
      bookId: created.book.id,
      linkedMaterialIdsByKind: {
        plot: ["material-long-plot", "missing-material"]
      },
      linkedSkillIdsByKind: {
        style: ["skill-long-style"]
      }
    });

    expect(updated.summary.linkedMaterialIdsByKind.plot).toEqual([
      "material-long-plot",
      "missing-material"
    ]);
    expect(updated.summary.linkedSkillIdsByKind.style).toEqual([
      "skill-long-style"
    ]);
    expect((await service.list()).books[0]).toMatchObject({
      id: created.book.id,
      linkedMaterialIdsByKind: {
        plot: ["material-long-plot", "missing-material"]
      }
    });
  });

  it("creates, lists, opens, pages, searches and directly writes by book id", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "雨夜来信",
      genre: "悬疑"
    });
    expect((await service.list()).books[0]?.id).toBe(created.book.id);
    const opened = await service.open({ bookId: created.book.id });
    const chapter = opened.book.workspaceIndex.chapters[0]!;

    await service.writeDocument({
      bookId: opened.book.id,
      fileId: chapter.body.id,
      content: "她在雨夜收到一封无法烧毁的来信。"
    });
    expect(
      (
        await service.search({
          bookId: opened.book.id,
          query: "来信",
          scope: "draft",
          limit: 20,
          maxSnippetCharacters: 100
        })
      ).hits[0]
    ).toMatchObject({
      fileId: chapter.body.id,
      root: "draft"
    });
  });

  it("reads, writes and searches every per-chapter continuity Markdown file", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-continuity-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-08-02T09:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "连续性文件服务",
      genre: "悬疑"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const characterId = "character_continuity_service";
    const updatedAt = "2026-08-02T09:01:00.000Z";
    const characterFiles = {
      characterId,
      coreProfile: createEmptyLongMarkdownFileReference(
        longCharacterCoreProfileFileId(characterId),
        longCharacterFilePath(characterId, "core-profile.md"),
        updatedAt
      ),
      relationships: createEmptyLongMarkdownFileReference(
        longCharacterRelationshipsFileId(characterId),
        longCharacterFilePath(characterId, "relationships.md"),
        updatedAt
      ),
      currentState: createEmptyLongMarkdownFileReference(
        longCharacterCurrentStateFileId(characterId),
        longCharacterFilePath(characterId, "current-state.md"),
        updatedAt
      ),
      history: createEmptyLongMarkdownFileReference(
        longCharacterHistoryFileId(characterId),
        longCharacterFilePath(characterId, "history.md"),
        updatedAt
      )
    };
    const worldReveals = createEmptyLongMarkdownFileReference(
      longChapterWorldRevealsFileId(chapter.chapterCardId),
      longChapterContinuityFilePath(chapter.chapterCardId, "world-reveals.md"),
      updatedAt
    );
    const currentState = createEmptyLongMarkdownFileReference(
      longChapterCharacterCurrentStateFileId(
        chapter.chapterCardId,
        characterId
      ),
      longChapterCharacterContinuityFilePath(
        chapter.chapterCardId,
        characterId,
        "current-state.md"
      ),
      updatedAt
    );
    const history = createEmptyLongMarkdownFileReference(
      longChapterCharacterHistoryFileId(chapter.chapterCardId, characterId),
      longChapterCharacterContinuityFilePath(
        chapter.chapterCardId,
        characterId,
        "history.md"
      ),
      updatedAt
    );
    await service.applyOperations({
      bookId: created.book.id,
      batch: {
        updatedAt,
        operations: [
          {
            type: "character.create",
            character: {
              id: characterId,
              name: "沈砚",
              group: "protagonist",
              order: 1,
              aliases: []
            },
            files: characterFiles
          },
          {
            type: "chapterContinuity.worldReveals.create",
            chapterCardId: chapter.chapterCardId,
            file: worldReveals
          },
          {
            type: "chapterContinuity.character.create",
            chapterCardId: chapter.chapterCardId,
            characterId,
            currentState,
            history
          }
        ],
        documentWrites: []
      }
    });

    const continuityFiles = [
      chapter.foreshadowingChanges,
      worldReveals,
      currentState,
      history
    ];
    for (const file of continuityFiles) {
      await expect(
        service.readDocument({
          bookId: created.book.id,
          fileId: file.id,
          offset: 0,
          maxCharacters: 100
        })
      ).resolves.toMatchObject({
        file: expect.objectContaining({ id: file.id }),
        content: ""
      });
    }

    const contents = new Map([
      [chapter.foreshadowingChanges.id, "铜铃伏笔在章末首次出现。"],
      [worldReveals.id, "城门只会在月蚀之夜显形。"],
      [currentState.id, "沈砚已经取得铜铃。"],
      [history.id, "第一章：沈砚取得铜铃。"]
    ]);
    for (const file of continuityFiles) {
      await service.writeDocument({
        bookId: created.book.id,
        fileId: file.id,
        content: contents.get(file.id)!
      });
    }

    for (const [fileId, query] of [
      [chapter.foreshadowingChanges.id, "铜铃伏笔"],
      [worldReveals.id, "月蚀之夜"],
      [currentState.id, "已经取得"],
      [history.id, "第一章"]
    ] as const) {
      await expect(
        service.search({
          bookId: created.book.id,
          query,
          scope: "continuity_ledger",
          limit: 20,
          maxSnippetCharacters: 100
        })
      ).resolves.toMatchObject({
        hits: [expect.objectContaining({ fileId, root: "continuity_ledger" })]
      });
    }
    await expect(
      service.search({
        bookId: created.book.id,
        query: "铜铃伏笔",
        scope: "draft",
        limit: 20,
        maxSnippetCharacters: 100
      })
    ).resolves.toMatchObject({ hits: [] });
  }, 15_000);

  it("reads, writes and searches a chapter-card file through the workspace service", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-card-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "章卡服务",
      genre: "悬疑"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    await service.writeDocument({
      bookId: created.book.id,
      fileId: chapter.card.id,
      content: "雨夜来信揭开失踪案的第一条线索。"
    });

    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: chapter.card.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      file: expect.objectContaining({ id: chapter.card.id }),
      content: "雨夜来信揭开失踪案的第一条线索。"
    });
    await expect(
      service.search({
        bookId: created.book.id,
        query: "失踪案",
        scope: "plot_design",
        limit: 20,
        maxSnippetCharacters: 100
      })
    ).resolves.toMatchObject({
      hits: [expect.objectContaining({ fileId: chapter.card.id })]
    });
  });

  it("automatically converts a legacy structured chapter card when the book is opened", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-card-open-migration-"))
    );
    const userDataPath = join(root, "user-data");
    const service = new LongWorkspaceService({
      userDataPath,
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "旧章卡自动迁移",
      genre: "悬疑"
    });
    const projectDirectory = join(root, "旧章卡自动迁移");
    const indexPath = join(projectDirectory, "long", "index.json");
    const rawIndex = JSON.parse(await readFile(indexPath, "utf8")) as {
      plot: { chapterCards: Array<Record<string, unknown>> };
      chapters: Array<Record<string, unknown>>;
    };
    const legacyCard = rawIndex.plot.chapterCards[0]!;
    const chapterFiles = rawIndex.chapters[0]!;
    const cardFile = chapterFiles.card as {
      id: string;
      path: string;
    };
    legacyCard.outline = "旧版章节规划会在打开时转换";
    legacyCard.worldConstraints = "旧版世界约束会保留下来";
    legacyCard.characterIds = [];
    delete chapterFiles.card;
    await unlink(join(projectDirectory, cardFile.path));
    const indexContent = `${JSON.stringify(rawIndex, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");

    const restarted = new LongWorkspaceService({
      userDataPath,
      now: () => "2026-07-26T11:00:00.000Z"
    });
    const opened = await restarted.open({ bookId: created.book.id });
    const migratedChapter = opened.book.workspaceIndex.chapters[0]!;
    expect(opened.book.workspaceIndex.plot.chapterCards[0]).not.toHaveProperty(
      "outline"
    );
    await expect(
      restarted.readDocument({
        bookId: created.book.id,
        fileId: migratedChapter.card.id,
        offset: 0,
        maxCharacters: 1_000
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("旧版章节规划会在打开时转换")
    });
  });

  it("keeps a successful store write successful when summary cache refresh fails", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-cache-failure-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "缓存降级",
      genre: "悬疑"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    service.catalog.updateSummary = async () => {
      throw new Error("simulated cache outage");
    };

    await service.writeDocument({
      bookId: created.book.id,
      fileId: chapter.body.id,
      content: "权威工程写入成功，目录摘要暂时失败。"
    });

    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: chapter.body.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: "权威工程写入成功，目录摘要暂时失败。"
    });
    expect(service.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "catalog-summary-cache-update-failed",
        bookId: created.book.id,
        operation: "write-document",
        message: "simulated cache outage"
      })
    ]);
  });

  it("previews and atomically applies a structure change", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-preview-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "结构测试",
      genre: "其他"
    });
    const batch = {
      updatedAt: "2026-07-26T11:00:00.000Z",
      operations: [
        {
          type: "volume.update" as const,
          id: created.book.workspaceIndex.plot.volumes[0]!.id,
          patch: { title: "新卷名" }
        },
        {
          type: "worldbuilding.create" as const,
          category: {
            id: "world_weather",
            title: "气候",
            order: 8,
            format: "text" as const,
            contentAuthority: "markdown" as const,
            file: createEmptyLongMarkdownFileReference(
              longWorldbuildingFileId("world_weather"),
              longWorldbuildingContentPath("world_weather"),
              "2026-07-26T11:00:00.000Z"
            )
          }
        },
        {
          type: "worldbuilding.create" as const,
          category: {
            id: "world_biomes",
            title: "生态区",
            order: 9,
            format: "list" as const,
            contentAuthority: "files" as const,
            items: []
          }
        }
      ],
      documentWrites: []
    };
    const preview = await service.previewOperations({
      bookId: created.book.id,
      batch
    });
    expect(preview.preview.impact.updatedEntityIds).toHaveLength(1);
    const applied = await service.applyOperations({
      bookId: created.book.id,
      batch
    });
    expect(applied.operationResult.snapshot.plot.volumes[0]?.title).toBe(
      "新卷名"
    );
    const reopened = await service.open({ bookId: created.book.id });
    expect(reopened.book.workspaceIndex.plot.volumes[0]?.title).toBe("新卷名");
    const weather = reopened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === "world_weather"
    )!;
    if (weather.format !== "text") throw new Error("expected text category");
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: weather.file.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: ""
    });
    const geography = reopened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === "world_biomes"
    );
    if (!geography || geography.format !== "list" || !geography.overview) {
      throw new Error("expected list category overview");
    }
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: geography.overview.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      file: expect.objectContaining({ id: geography.overview.id }),
      content: ""
    });
  });

  it("creates a story plot file and can read it back by file id", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-story-plot-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "故事情节书",
      genre: "奇幻"
    });
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    const storyPlotId = "storyplot_daily_collapse";
    const updatedAt = "2026-07-26T10:00:00.000Z";
    const applied = await service.applyOperations({
      bookId: created.book.id,
      batch: {
        updatedAt,
        operations: [
          {
            type: "storyPlot.create",
            storyPlot: {
              id: storyPlotId,
              arcId,
              title: "日常崩塌",
              order: 1,
              file: createEmptyLongMarkdownFileReference(
                longStoryPlotBodyFileId(storyPlotId),
                longStoryPlotFilePath(storyPlotId),
                updatedAt
              )
            }
          }
        ],
        documentWrites: []
      }
    });
    const storyPlot = applied.operationResult.snapshot.plot.storyPlots.find(
      ({ id }) => id === storyPlotId
    );
    expect(storyPlot).toBeTruthy();

    const empty = await service.readDocument({
      bookId: created.book.id,
      fileId: longStoryPlotBodyFileId(storyPlotId),
      offset: 0,
      maxCharacters: 100
    });
    expect(empty.file.id).toBe(longStoryPlotBodyFileId(storyPlotId));
    expect(empty.content).toBe("");

    await service.writeDocument({
      bookId: created.book.id,
      fileId: longStoryPlotBodyFileId(storyPlotId),
      content: "世界突然变得透明。"
    });
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: longStoryPlotBodyFileId(storyPlotId),
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: "世界突然变得透明。"
    });
  });
});
