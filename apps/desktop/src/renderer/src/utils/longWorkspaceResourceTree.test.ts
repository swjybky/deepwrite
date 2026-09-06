import { describe, expect, it } from "vitest";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import source from "./longWorkspaceResourceTree.ts?raw";
import {
  longNavigationNodeId,
  projectLongWorkspaceNavigation
} from "./longWorkspaceResourceTree";

function summaryFixture(): LongBookSummary {
  return {
    id: "longbook_tree",
    title: "资源树测试",
    navigation: {
      worldbuilding: [
        {
          id: "world_geography",
          title: "地理",
          order: 1,
          format: "list"
        }
      ],
      characterTypes: [
        { id: "supporting", title: "配角", order: 2 },
        { id: "protagonist", title: "主角", order: 1 }
      ],
      characters: [
        {
          id: "character_two",
          name: "闻川",
          group: "supporting",
          order: 1
        },
        {
          id: "character_one",
          name: "林岚",
          group: "protagonist",
          order: 1
        },
        {
          id: "character_three",
          name: "谢青",
          group: "supporting",
          order: 2
        }
      ],
      volumes: [
        { id: "volume_two", title: "第二卷", order: 2 },
        { id: "volume_one", title: "第一卷", order: 1 }
      ],
      arcs: [
        { id: "arc_two", volumeId: "volume_two", title: "剧情二", order: 1 },
        { id: "arc_one", volumeId: "volume_one", title: "剧情一", order: 1 },
        { id: "arc_three", volumeId: "volume_one", title: "剧情三", order: 2 }
      ],
      chapterCards: [
        {
          id: "chapter_two",
          volumeId: "volume_one",
          title: "第二章",
          narrativeOrder: 2,
          bodyStatus: "empty"
        },
        {
          id: "chapter_three",
          volumeId: "volume_two",
          title: "第三章",
          narrativeOrder: 1,
          bodyStatus: "empty"
        },
        {
          id: "chapter_one",
          volumeId: "volume_one",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "empty"
        }
      ],
      counts: {
        worldbuildingCategories: 1,
        characters: 3,
        arcs: 3,
        volumes: 2,
        chapterCards: 3,
        foreshadowingThreads: 0,
        committedChapters: 0
      }
    }
  } as unknown as LongBookSummary;
}

const updatedAt = "2026-08-14T08:00:00.000Z";

function file(id: string, path: string) {
  return { id, path, updatedAt };
}

function indexFixture(): LongWorkspaceIndexSnapshot {
  const summary = summaryFixture();
  return {
    schemaVersion: 1,
    bookId: summary.id,
    updatedAt,
    featureSettings: {
      worldbuildingItemLayout: "left-tree",
      characterAndContinuityItemLayout: "left-tree",
      plotItemLayout: "left-tree"
    },
    bookLine: file("file_book-line", "long/plot/book-line.md"),
    worldbuilding: [
      {
        id: "world_geography",
        title: "地理",
        order: 1,
        format: "list",
        contentAuthority: "files",
        overview: file(
          "file_world_geography:overview",
          "long/worldbuilding/world_geography/overview.md"
        ),
        items: [
          {
            id: "worlditem_plain",
            title: "平原",
            order: 1,
            file: file(
              "file_worlditem_plain:content",
              "long/worldbuilding/world_geography/items/worlditem_plain.md"
            )
          },
          {
            id: "worlditem_harbor",
            title: "港口",
            order: 2,
            file: file(
              "file_worlditem_harbor:content",
              "long/worldbuilding/world_geography/items/worlditem_harbor.md"
            )
          }
        ]
      }
    ],
    characterTypes: summary.navigation.characterTypes,
    characterOverview: file(
      "file_character-overview",
      "long/characters/overview.md"
    ),
    characters: summary.navigation.characters.map((character) => ({
      ...character,
      aliases: []
    })),
    characterFiles: summary.navigation.characters.map((character) => ({
      characterId: character.id,
      coreProfile: file(
        `file_${character.id}:core-profile`,
        `long/characters/${character.id}/core-profile.md`
      ),
      relationships: file(
        `file_${character.id}:relationships`,
        `long/characters/${character.id}/relationships.md`
      ),
      currentState: file(
        `file_${character.id}:current-state`,
        `long/characters/${character.id}/current-state.md`
      ),
      history: file(
        `file_${character.id}:history`,
        `long/characters/${character.id}/history.md`
      )
    })),
    plot: {
      volumes: summary.navigation.volumes.map((volume) => ({
        ...volume,
        summary: ""
      })),
      arcs: summary.navigation.arcs.map((arc) => ({
        ...arc,
        summary: "",
        outline: ""
      })),
      chapterCards: summary.navigation.chapterCards.map((chapter) => ({
        id: chapter.id,
        volumeId: chapter.volumeId,
        primaryArcId: null,
        title: chapter.title,
        narrativeOrder: chapter.narrativeOrder
      })),
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: summary.navigation.chapterCards.map((chapter, index) => ({
      chapterCardId: chapter.id,
      bodyStatus: index === 0 ? "written" : "empty",
      body: file(
        `file_${chapter.id}:body`,
        `long/chapters/${chapter.id}/body.md`
      ),
      card: file(
        `file_${chapter.id}:card`,
        `long/chapters/${chapter.id}/card.md`
      ),
      characterState: file(
        `file_${chapter.id}:character-state`,
        `long/chapters/${chapter.id}/character-state.md`
      ),
      handoff: file(
        `file_${chapter.id}:handoff`,
        `long/chapters/${chapter.id}/handoff.md`
      ),
      foreshadowingChanges: file(
        `file_${chapter.id}:foreshadowing-changes`,
        `long/chapters/${chapter.id}/foreshadowing-changes.md`
      ),
      worldReveals: null,
      characterContinuity: [],
      commitId: null
    })),
    ledger: {
      committedThroughChapterId: null,
      commits: []
    }
  } as unknown as LongWorkspaceIndexSnapshot;
}

describe("long workspace resource-tree projection", () => {
  it("keeps group counts and ordered volume/chapter output", () => {
    const roots = projectLongWorkspaceNavigation(summaryFixture());
    const characters = roots.find(({ label }) => label === "人物设计");
    expect(
      characters?.children
        ?.slice(1)
        .map(({ label, badge }) => ({ label, badge }))
    ).toEqual([
      { label: "主角", badge: "1" },
      { label: "配角", badge: "2" }
    ]);

    const plot = roots.find(({ label }) => label === "剧情设计");
    const plotPoints = plot?.children?.find(({ label }) => label === "剧情点");
    expect(
      plotPoints?.children?.map(({ label, badge }) => ({ label, badge }))
    ).toEqual([
      { label: "第一卷", badge: "2 点" },
      { label: "第二卷", badge: "1 点" }
    ]);

    const draft = roots.find(({ label }) => label === "正文");
    expect(draft?.longTreeCollection).toEqual({ kind: "volume" });
    expect(draft?.children?.map(({ label }) => label)).toEqual([
      "第一卷",
      "第二卷"
    ]);
    expect(draft?.children?.[0]?.children?.map(({ label }) => label)).toEqual([
      "第一章",
      "第二章"
    ]);
    expect(longNavigationNodeId("longbook_tree", "chapter:chapter_one")).toBe(
      "long-book:longbook_tree:chapter:chapter_one"
    );
  });

  it("shows manuscript status from body and ledger state", () => {
    const index = indexFixture();
    const first = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === "chapter_one"
    );
    const second = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === "chapter_two"
    );
    if (!first || !second) throw new Error("missing chapter fixture");
    first.bodyStatus = "written";
    first.commitId = "commit_first";
    second.bodyStatus = "written";

    const draft = projectLongWorkspaceNavigation(summaryFixture(), index).find(
      ({ label }) => label === "正文"
    );

    expect(
      draft?.children?.flatMap(({ children = [] }) =>
        children.map(({ label, badge }) => ({ label, badge }))
      )
    ).toEqual([
      { label: "第一章", badge: "已完成" },
      { label: "第二章", badge: "待提交" },
      { label: "第三章", badge: "待编写" }
    ]);
  });

  it("marks every commit row for its menu and enables deletion only on the last row", () => {
    const index = indexFixture();
    const first = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === "chapter_one"
    )!;
    const second = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === "chapter_two"
    )!;
    first.commitId = "commit_first";
    second.commitId = "commit_latest";
    index.ledger.commits = [
      {
        id: "commit_first",
        mode: "text_files",
        sequence: 1,
        chapterCardId: "chapter_one",
        committedAt: updatedAt,
        placementIds: [],
        foreshadowingBeatIds: [],
        recordFile: file(
          "file_commit_first:ledger-record",
          "long/ledger/commit_first.json"
        )
      },
      {
        id: "commit_latest",
        mode: "text_files",
        sequence: 2,
        chapterCardId: "chapter_two",
        committedAt: updatedAt,
        placementIds: [],
        foreshadowingBeatIds: [],
        recordFile: file(
          "file_commit_latest:ledger-record",
          "long/ledger/commit_latest.json"
        )
      }
    ];

    const records = projectLongWorkspaceNavigation(summaryFixture(), index)
      .find(({ label }) => label === "连续性账本")
      ?.children?.find(({ label }) => label === "章节记录")?.children;
    expect(records?.map(({ longLedgerCommit }) => longLedgerCommit)).toEqual([
      { id: "commit_first", deletable: false },
      { id: "commit_latest", deletable: true }
    ]);
    const fileRows = records?.flatMap(({ children = [] }) => children) ?? [];
    expect(fileRows.length).toBeGreaterThan(0);
    expect(
      fileRows.every(({ longLedgerCommit }) => longLedgerCommit === undefined)
    ).toBe(true);
  });

  it("indexes repeated group and volume relationships before projection", () => {
    expect(source).toContain("const characterCountByGroup = new Map");
    expect(source).toContain("const arcCountByVolume = new Map");
    expect(source).toContain("const chaptersByVolume = new Map");
    expect(source).not.toContain("book.navigation.characters.filter(");
    expect(source).not.toContain("book.navigation.arcs.filter(");
    expect(source).not.toContain(
      "book.navigation.chapterCards\n        .filter("
    );
  });

  it("projects configured collections into stable left-tree children", () => {
    const roots = projectLongWorkspaceNavigation(
      summaryFixture(),
      indexFixture()
    );

    const world = roots.find(({ label }) => label === "世界观");
    const geography = world?.children?.find(({ label }) => label === "地理");
    expect(geography?.longTreeCollection).toEqual({
      kind: "worldbuilding-item",
      parentId: "world_geography"
    });
    expect(geography?.children?.map(({ label }) => label)).toEqual([
      "概览",
      "平原",
      "港口"
    ]);
    expect(geography?.children?.[1]).toMatchObject({
      id: "long-book:longbook_tree:worldbuilding:world_geography:item:worlditem_plain",
      longTreeItem: {
        kind: "worldbuilding-item",
        id: "worlditem_plain",
        parentId: "world_geography"
      },
      longWorkspaceSelection: {
        worldbuildingItemId: "worlditem_plain",
        preferredFileId: "file_worlditem_plain:content"
      }
    });

    const characters = roots.find(({ label }) => label === "人物设计");
    const supporting = characters?.children?.find(
      ({ label }) => label === "配角"
    );
    expect(supporting?.longTreeCollection).toEqual({
      kind: "character",
      parentId: "supporting"
    });
    expect(supporting?.children?.map(({ label }) => label)).toEqual([
      "闻川",
      "谢青"
    ]);
    expect(supporting?.children?.[0]?.id).toBe(
      "long-book:longbook_tree:character:character_two"
    );

    const plot = roots.find(({ label }) => label === "剧情设计");
    const bookLine = plot?.children?.find(
      ({ label }) => label === "全书故事线"
    );
    expect(bookLine?.longTreeCollection).toEqual({ kind: "volume" });
    expect(bookLine?.children?.map(({ label }) => label)).toEqual([
      "全书总纲",
      "第一卷",
      "第二卷"
    ]);
    expect(bookLine?.children?.[1]).toMatchObject({
      id: "long-book:longbook_tree:plot-design:book-line:volume:volume_one",
      longTreeItem: { kind: "volume", id: "volume_one" },
      longWorkspaceSelection: { bookLineVolumeId: "volume_one" }
    });

    const plotPoints = plot?.children?.find(({ label }) => label === "剧情点");
    expect(
      plotPoints?.children?.[0]?.children?.map(({ label }) => label)
    ).toEqual(["剧情一", "剧情三"]);
    expect(plotPoints?.children?.[0]?.longTreeCollection).toEqual({
      kind: "plot-point",
      parentId: "volume_one"
    });

    const chapterCards = plot?.children?.find(({ label }) => label === "章卡");
    expect(
      chapterCards?.children?.[0]?.children?.map(({ label }) => label)
    ).toEqual(["第一章", "第二章"]);
    expect(chapterCards?.children?.[0]?.longTreeCollection).toEqual({
      kind: "chapter-card",
      parentId: "volume_one"
    });

    const draft = roots.find(({ label }) => label === "正文");
    expect(draft?.longTreeCollection).toEqual({ kind: "volume" });

    const continuity = roots.find(({ label }) => label === "连续性账本");
    const pendingChapter = continuity?.children?.[0]?.children?.[0];
    expect(pendingChapter?.badge).toBe("待提交");
    expect(pendingChapter?.children?.length).toBeGreaterThan(0);
    expect(
      pendingChapter?.children?.every(
        (child) =>
          Boolean(child.readOnly) === (child.label === "正文证据") &&
          child.longTreeItem === undefined
      )
    ).toBe(true);
    expect(pendingChapter?.children?.[0]?.longWorkspaceSelection).toMatchObject(
      {
        preferredFileId: "file_chapter_two:body"
      }
    );
  });

  it("keeps an empty list parent actionable in left-tree mode", () => {
    const index = indexFixture();
    const category = index.worldbuilding[0];
    if (!category || category.format !== "list") {
      throw new Error("missing list category fixture");
    }
    category.items = [];
    const roots = projectLongWorkspaceNavigation(summaryFixture(), index);
    const geography = roots
      .find(({ label }) => label === "世界观")
      ?.children?.find(({ label }) => label === "地理");
    expect(geography?.children?.map(({ label }) => label)).toEqual(["概览"]);
    expect(geography?.longTreeCollection).toEqual({
      kind: "worldbuilding-item",
      parentId: "world_geography"
    });
  });
  it.each(["left-tree", "right-list", "top-tabs"] as const)(
    "reflects continuity commit deletion and resubmission in %s layout",
    (layout) => {
      const index = indexFixture();
      index.featureSettings.characterAndContinuityItemLayout = layout;
      const chapter = index.chapters[0]!;
      const select = (label: string) =>
        projectLongWorkspaceNavigation(summaryFixture(), index)
          .find(({ label }) => label === "连续性账本")
          ?.children?.find((node) => node.label === label)?.children?.[0];
      const assertPermissions = (label: string, committed: boolean) => {
        const node = select(label)!;
        expect(
          node.longWorkspaceSelection?.files.find(({ role }) => role === "body")
            ?.readOnly
        ).toBe(true);
        expect(
          node.longWorkspaceSelection?.files
            .filter(({ role }) => role !== "body")
            .every(({ readOnly }) => readOnly === committed)
        ).toBe(true);
        if (layout === "left-tree") {
          const handoff = node.children?.find(
            ({ label }) => label === "接续包"
          );
          expect(handoff).toBeDefined();
          expect(Boolean(handoff?.readOnly)).toBe(committed);
        }
      };
      assertPermissions("待处理章节", false);
      const commit = {
        id: "commit_permissions",
        mode: "text_files" as const,
        sequence: 1,
        chapterCardId: chapter.chapterCardId,
        committedAt: updatedAt,
        placementIds: [],
        foreshadowingBeatIds: [],
        recordFile: file(
          "file_permissions_record",
          "long/ledger/commit_permissions.json"
        )
      };
      chapter.commitId = commit.id;
      index.ledger.commits = [commit];
      assertPermissions("章节记录", true);
      chapter.commitId = null;
      index.ledger.commits = [];
      assertPermissions("待处理章节", false);
      chapter.commitId = commit.id;
      index.ledger.commits = [commit];
      assertPermissions("章节记录", true);
    }
  );
});
