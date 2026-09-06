import { describe, expect, it } from "vitest";
import { file, fixture } from "./longWorkspace.test-support";
import {
  createLongCharacterGroupSelection,
  createLongCharacterOverviewSelection,
  createLongChapterCardVolumeSelection,
  createLongChapterSelection,
  latestCommittedContinuityChapter,
  longBookIdFromResourceId,
  longBookResourceId,
  reconcileLongWorkspaceSelection
} from "./longWorkspace";

describe("long workspace chapter navigation", () => {
  it("keeps chapter cards in right-side volume tabs", () => {
    const { summary, workspaceIndex } = fixture(null);
    summary.navigation.chapterCards.push({
      ...summary.navigation.chapterCards[0]!,
      id: "chapter_two",
      title: "第二章",
      narrativeOrder: 2
    });
    workspaceIndex.plot.chapterCards.push({
      ...workspaceIndex.plot.chapterCards[0]!,
      id: "chapter_two",
      narrativeOrder: 2
    });

    const selection = createLongChapterCardVolumeSelection(
      summary,
      workspaceIndex,
      "volume_one",
      "chapter_two"
    );

    expect(selection).toMatchObject({
      key: "plot-design:chapter-cards:volume_one",
      chapterCardVolumeId: "volume_one",
      chapterCardId: "chapter_two",
      title: "第二章",
      breadcrumbs: ["长篇生命周期", "剧情设计", "章卡", "第一卷", "第二章"],
      chapterCardTabs: [
        { id: "chapter_one", label: "第一章" },
        { id: "chapter_two", label: "第二章" }
      ]
    });
  });

  it("binds one volume to multiple plot-point tabs", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = reconcileLongWorkspaceSelection(summary, workspaceIndex, {
      key: "plot-design:plot-points:volume_one",
      root: "plot_design",
      plotPointVolumeId: "volume_one",
      plotPointId: "arc_two",
      title: "第一卷",
      breadcrumbs: [],
      files: [],
      preferredRole: "book-line"
    });

    expect(selection).toMatchObject({
      key: "plot-design:plot-points:volume_one",
      plotPointVolumeId: "volume_one",
      plotPointId: "arc_two",
      title: "剧情点二",
      breadcrumbs: ["长篇生命周期", "剧情设计", "剧情点", "第一卷", "剧情点二"],
      plotPointTabs: [
        { id: "arc_one", label: "剧情点一" },
        { id: "arc_two", label: "剧情点二" }
      ]
    });
    expect(selection?.files).toEqual([
      {
        role: "book-line",
        label: "剧情点",
        file: workspaceIndex.bookLine
      }
    ]);
  });

  it("reconciles the dedicated foreshadowing overview without a duplicate document", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = reconcileLongWorkspaceSelection(summary, workspaceIndex, {
      key: "plot-design:foreshadowing",
      root: "plot_design",
      title: "伏笔总览",
      breadcrumbs: [],
      files: [],
      preferredRole: "book-line"
    });

    expect(selection).toMatchObject({
      key: "plot-design:foreshadowing",
      root: "plot_design",
      title: "伏笔总览",
      breadcrumbs: ["长篇生命周期", "剧情设计", "伏笔总览"],
      files: []
    });
  });

  it("reconciles the stage-level character overview selection", () => {
    const { summary, workspaceIndex } = fixture(null);
    workspaceIndex.characterOverview = file(
      "file_characters:overview",
      "long/characters/overview.md"
    );

    const selection = createLongCharacterOverviewSelection(
      summary,
      workspaceIndex
    );
    expect(selection).toMatchObject({
      key: "character-overview",
      root: "character_design",
      title: "概览",
      preferredRole: "overview"
    });
    expect(selection?.files).toEqual([
      {
        role: "overview",
        label: "概览",
        file: workspaceIndex.characterOverview
      }
    ]);
    expect(
      reconcileLongWorkspaceSelection(summary, workspaceIndex, {
        key: "character-overview",
        root: "character_design",
        title: "概览",
        breadcrumbs: [summary.title, "人物设计", "概览"],
        files: [],
        preferredRole: "overview"
      })
    ).toMatchObject({ key: "character-overview", preferredRole: "overview" });
  });

  it("keeps character names in right-side tabs instead of tree descendants", () => {
    const { summary, workspaceIndex } = fixture(null);
    summary.navigation.characters = [
      {
        id: "character_lead",
        name: "沈文佳",
        group: "protagonist",
        order: 1
      },
      {
        id: "character_partner",
        name: "顾临",
        group: "protagonist",
        order: 2
      }
    ] as typeof summary.navigation.characters;
    workspaceIndex.characterFiles = [
      {
        characterId: "character_lead",
        coreProfile: file(
          "file_character_lead:core-profile",
          "long/characters/character_lead/core-profile.md"
        ),
        relationships: file(
          "file_character_lead:relationships",
          "long/characters/character_lead/relationships.md"
        )
      },
      {
        characterId: "character_partner",
        coreProfile: file(
          "file_character_partner:core-profile",
          "long/characters/character_partner/core-profile.md"
        ),
        relationships: file(
          "file_character_partner:relationships",
          "long/characters/character_partner/relationships.md"
        )
      }
    ] as typeof workspaceIndex.characterFiles;

    const selection = createLongCharacterGroupSelection(
      summary,
      workspaceIndex,
      "protagonist",
      "character_partner"
    );

    expect(selection).toMatchObject({
      key: "character-group:protagonist",
      characterGroup: "protagonist",
      characterId: "character_partner",
      title: "顾临"
    });
    expect(selection.characterTabs).toEqual([
      { id: "character_lead", label: "沈文佳" },
      { id: "character_partner", label: "顾临" }
    ]);
    expect(selection.files.map(({ role }) => role)).toEqual([
      "core-profile",
      "relationships",
      "current-state",
      "history"
    ]);
    expect(
      selection.files
        .filter(({ role }) => role === "current-state" || role === "history")
        .map(({ inlineContent, readOnly }) => ({ inlineContent, readOnly }))
    ).toEqual([
      { inlineContent: "", readOnly: true },
      { inlineContent: "", readOnly: true }
    ]);

    const emptyGroup = createLongCharacterGroupSelection(
      summary,
      workspaceIndex,
      "major_supporting"
    );
    expect(emptyGroup).toMatchObject({
      key: "character-group:major_supporting",
      title: "主要配角",
      characterTabs: [],
      files: []
    });
  });

  it("keeps the owning book id when a standard tree descendant is selected", () => {
    const bookId = "longbook_lifecycle";
    expect(longBookIdFromResourceId(longBookResourceId(bookId))).toBe(bookId);
    expect(
      longBookIdFromResourceId(
        `${longBookResourceId(bookId)}:root:worldbuilding`
      )
    ).toBe(bookId);
  });

  it("opens a chapter from the workspace index when book navigation is stale", () => {
    const { summary, workspaceIndex } = fixture(null);
    summary.navigation.volumes = [];
    summary.navigation.chapterCards = [];
    workspaceIndex.plot.chapterCards[0] = {
      ...workspaceIndex.plot.chapterCards[0]!,
      title: "第一章"
    };

    const selection = createLongChapterSelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(selection).toMatchObject({
      key: "chapter:chapter_one",
      root: "draft",
      chapterCardId: "chapter_one",
      title: "第一章"
    });
    expect(selection?.files[0]?.file.id).toBe("file_chapter_body");
  });

  it("keeps only the body editable before continuity generates projections", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = createLongChapterSelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(selection).toMatchObject({
      key: "chapter:chapter_one",
      root: "draft",
      chapterCardId: "chapter_one"
    });
    expect(
      selection?.files.find(({ role }) => role === "body")?.readOnly
    ).toBeUndefined();
    expect(
      selection?.files
        .filter(({ role }) => role !== "body")
        .every((entry) => entry.readOnly)
    ).toBe(true);
    expect(selection?.description).toContain("正文已完成");
  });

  it("maps character state and history to the latest committed chapter", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    summary.navigation.characters = [
      {
        id: "character_lead",
        name: "沈文佳",
        group: "protagonist",
        order: 1
      }
    ] as typeof summary.navigation.characters;
    const designFiles = {
      characterId: "character_lead",
      coreProfile: file(
        "core",
        "long/characters/character_lead/core-profile.md"
      ),
      relationships: file(
        "relationships",
        "long/characters/character_lead/relationships.md"
      )
    };
    workspaceIndex.characterFiles = [
      designFiles
    ] as typeof workspaceIndex.characterFiles;
    const mappedState = file(
      "chapter-state",
      "long/chapters/chapter_one/continuity/characters/character_lead/current-state.md"
    );
    const mappedHistory = file(
      "chapter-history",
      "long/chapters/chapter_one/continuity/characters/character_lead/history.md"
    );
    workspaceIndex.ledger.commits[0]!.mode = "text_files";
    workspaceIndex.chapters[0]!.characterContinuity = [
      {
        characterId: "character_lead",
        currentState: mappedState,
        history: mappedHistory
      }
    ];

    expect(
      latestCommittedContinuityChapter(workspaceIndex)?.chapterCardId
    ).toBe("chapter_one");
    const selection = createLongCharacterGroupSelection(
      summary,
      workspaceIndex,
      "protagonist",
      "character_lead"
    );
    expect(
      selection.files.find(({ role }) => role === "current-state")?.file
    ).toBe(mappedState);
    expect(selection.files.find(({ role }) => role === "history")?.file).toBe(
      mappedHistory
    );
    expect(
      selection.files.find(({ role }) => role === "current-state")?.readOnly
    ).toBe(true);
    expect(
      selection.files.find(({ role }) => role === "history")?.readOnly
    ).toBe(true);
    expect(
      selection.files.find(({ role }) => role === "relationships")?.readOnly
    ).toBeUndefined();

    const textCommit = workspaceIndex.ledger.commits[0]!;
    textCommit.sequence = 2;
    workspaceIndex.ledger.commits.push({
      ...textCommit,
      id: "commit_legacy",
      mode: "structured",
      sequence: 1
    });
    expect(
      createLongCharacterGroupSelection(
        summary,
        workspaceIndex,
        "protagonist",
        "character_lead"
      ).files.find(({ role }) => role === "relationships")?.readOnly
    ).toBeUndefined();
  });

  it("keeps the foreshadowing workspace as the global design overview", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    workspaceIndex.ledger.commits[0]!.mode = "text_files";
    const selection = reconcileLongWorkspaceSelection(summary, workspaceIndex, {
      key: "plot-design:foreshadowing",
      root: "plot_design",
      title: "伏笔总览",
      breadcrumbs: [],
      files: [],
      preferredRole: "book-line"
    });
    expect(selection).toMatchObject({
      title: "伏笔总览",
      files: [],
      preferredRole: "book-line",
      description: "维护全书伏笔线及其埋设、推进、揭示与回收触点。"
    });
  });

  it("maps a committed legacy structured chapter without a version marker", () => {
    const { workspaceIndex } = fixture("commit_one");
    expect(
      latestCommittedContinuityChapter(workspaceIndex)?.chapterCardId
    ).toBe("chapter_one");
  });

  it("maps the worldbuilding stage to the newest committed reveal file", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    workspaceIndex.ledger.commits[0]!.mode = "text_files";
    const reveal = file(
      "chapter-world-reveal",
      "long/continuity/chapters/chapter_one/world-reveals.md"
    );
    workspaceIndex.chapters[0]!.worldReveals = reveal;

    const selection = reconcileLongWorkspaceSelection(summary, workspaceIndex, {
      key: "worldbuilding:reveals",
      root: "worldbuilding",
      title: "世界观揭露",
      breadcrumbs: [],
      files: [],
      preferredRole: "world-reveals"
    });

    expect(selection?.files).toEqual([
      {
        role: "world-reveals",
        label: "世界观揭露",
        file: reveal,
        readOnly: true
      }
    ]);
  });
});
