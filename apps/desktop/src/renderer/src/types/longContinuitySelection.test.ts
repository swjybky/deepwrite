import { describe, expect, it } from "vitest";
import { file, fixture } from "./longWorkspace.test-support";
import {
  createLongContinuitySelection,
  createLongChapterSelection,
  createLongChapterCardVolumeSelection,
  reconcileLongWorkspaceSelection
} from "./longWorkspace";

describe("continuity selection permissions", () => {
  it("allows pending continuity edits while keeping body evidence read-only", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = createLongContinuitySelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(selection).toMatchObject({
      key: "continuity:chapter_one",
      root: "continuity_ledger",
      continuityView: "inbox",
      chapterCardId: "chapter_one"
    });
    expect(selection?.files.map(({ role }) => role)).toEqual([
      "body",
      "foreshadowing-changes",
      "character-state",
      "handoff"
    ]);
    expect(
      selection?.files
        .filter(({ role }) => role !== "body")
        .every((entry) => !entry.readOnly)
    ).toBe(true);
    expect(selection?.files.find(({ role }) => role === "body")?.readOnly).toBe(
      true
    );
    expect(
      reconcileLongWorkspaceSelection(summary, workspaceIndex, selection!)
    ).toMatchObject({
      root: "continuity_ledger",
      chapterCardId: "chapter_one"
    });
  });

  it("keeps committed body editable while locking generated continuity files", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    const chapter = createLongChapterSelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(
      chapter?.files.find(({ role }) => role === "body")?.readOnly
    ).toBeUndefined();
    expect(
      chapter?.files
        .filter(({ role }) => role !== "body")
        .every((entry) => entry.readOnly)
    ).toBe(true);
    expect(chapter?.description).toContain("记录仅供参考");
    const chapterCard = createLongChapterCardVolumeSelection(
      summary,
      workspaceIndex,
      "volume_one",
      "chapter_one"
    );
    expect(
      chapterCard?.files.find(({ role }) => role === "card")?.readOnly
    ).toBeUndefined();
    expect(chapterCard?.description).toContain("章卡仍可自由修改");
    expect(
      createLongContinuitySelection(summary, workspaceIndex, "chapter_one")
    ).toMatchObject({
      key: "continuity:chapter_one",
      continuityView: "history"
    });
  });

  it("offers continuity review for every written unrecorded chapter", () => {
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
    workspaceIndex.chapters.push({
      chapterCardId: "chapter_two",
      bodyStatus: "written",
      body: file("file_chapter_two_body", "chapters/chapter-two/body.md"),
      card: file("file_chapter_two_card", "chapters/chapter-two/card.md"),
      characterState: file(
        "file_chapter_two_state",
        "chapters/chapter-two/character-state.md"
      ),
      handoff: file(
        "file_chapter_two_handoff",
        "chapters/chapter-two/handoff.md"
      ),
      foreshadowingChanges: file(
        "file_chapter_two_foreshadowing",
        "chapters/chapter-two/continuity/foreshadowing-changes.md"
      ),
      worldReveals: null,
      characterContinuity: [],
      commitId: null
    });

    expect(
      createLongContinuitySelection(summary, workspaceIndex, "chapter_two")
    ).toMatchObject({
      key: "continuity:chapter_two",
      chapterCardId: "chapter_two"
    });
    expect(
      createLongContinuitySelection(summary, workspaceIndex, "chapter_one")
    ).toMatchObject({
      chapterCardId: "chapter_one"
    });
  });

  it.each([null, "commit_one"])(
    "maps all continuity outputs with commit %s without exposing commit JSON",
    (commitId) => {
      const { summary, workspaceIndex } = fixture(commitId);
      if (commitId) workspaceIndex.ledger.commits[0]!.mode = "text_files";
      workspaceIndex.chapters[0]!.worldReveals = file(
        "file_chapter_world",
        "long/chapters/chapter_one/continuity/world-reveals.md"
      );
      workspaceIndex.chapters[0]!.characterContinuity = [
        {
          characterId: "character_lead",
          currentState: file(
            "file_chapter_character_state",
            "long/chapters/chapter_one/continuity/characters/character_lead/current-state.md"
          ),
          history: file(
            "file_chapter_character_history",
            "long/chapters/chapter_one/continuity/characters/character_lead/history.md"
          )
        }
      ];
      summary.navigation.characters = [
        {
          id: "character_lead",
          name: "沈文佳",
          group: "protagonist",
          order: 1
        }
      ] as typeof summary.navigation.characters;

      const selection = createLongContinuitySelection(
        summary,
        workspaceIndex,
        "chapter_one"
      );

      expect(selection?.files.map(({ label }) => label)).toEqual([
        "正文证据",
        "沈文佳 · 当前状态",
        "沈文佳 · 历史轨迹",
        "世界观揭露",
        "伏笔变化",
        "章末状态",
        "接续包"
      ]);
      expect(
        selection?.files.every(
          ({ role, readOnly }) =>
            readOnly === (role === "body" || commitId !== null)
        )
      ).toBe(true);
      expect(
        selection?.files.some(({ role }) => role === "ledger-record")
      ).toBe(false);
    }
  );

  it("shows an import checkpoint as body evidence without empty continuity outputs", () => {
    const { summary, workspaceIndex } = fixture("commit_import");
    workspaceIndex.ledger.commits[0]!.mode = "import_checkpoint";
    const selection = createLongContinuitySelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );
    expect(selection?.files.map(({ role }) => role)).toEqual(["body"]);
    expect(selection?.description).toContain("仅表示历史正文已封存");
  });

  it("refreshes the selected file permissions after commit deletion and resubmission", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    const committed = createLongContinuitySelection(
      summary,
      workspaceIndex,
      "chapter_one"
    )!;
    const handoff = committed.files.find(({ role }) => role === "handoff")!;
    const selected = { ...committed, preferredFileId: handoff.file.id };
    const records = workspaceIndex.ledger.commits;
    workspaceIndex.chapters[0]!.commitId = null;
    workspaceIndex.ledger.commits = [];
    const pending = reconcileLongWorkspaceSelection(
      summary,
      workspaceIndex,
      selected
    )!;
    expect(pending.continuityView).toBe("inbox");
    expect(pending.preferredFileId).toBe(handoff.file.id);
    expect(pending.files.find(({ role }) => role === "handoff")?.readOnly).toBe(
      false
    );
    workspaceIndex.chapters[0]!.commitId = "commit_one";
    workspaceIndex.ledger.commits = records;
    const resubmitted = reconcileLongWorkspaceSelection(
      summary,
      workspaceIndex,
      pending
    )!;
    expect(resubmitted.continuityView).toBe("history");
    expect(resubmitted.files.every(({ readOnly }) => readOnly)).toBe(true);
  });
});
