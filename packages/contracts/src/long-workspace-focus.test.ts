import { describe, expect, it } from "vitest";
import { LongWorldbuildingFocusSnapshotSchema } from "./long-workspace-runtime/worldbuilding";
import { LongCharacterFocusSnapshotSchema } from "./long-workspace-runtime/character";

const world = {
  categoryId: "world_factions",
  categoryTitle: "势力",
  format: "list",
  currentStage: { kind: "item", itemId: "worlditem_watch", title: "守夜人" }
};
const character = {
  characterId: "character_lan",
  characterName: "林岚",
  group: "protagonist",
  currentDocument: { kind: "relationships", title: "人物关系" }
};

describe("long focus location snapshots", () => {
  it("rejects invalid ids and mismatched locations before accepting lightweight snapshots", () => {
    expect(() =>
      LongWorldbuildingFocusSnapshotSchema.parse({
        ...world,
        categoryId: "character_lan"
      })
    ).toThrow();
    expect(() =>
      LongWorldbuildingFocusSnapshotSchema.parse({
        ...world,
        currentStage: { ...world.currentStage, kind: "overview" }
      })
    ).toThrow(/item id/u);
    expect(() =>
      LongCharacterFocusSnapshotSchema.parse({
        ...character,
        characterId: "world_factions"
      })
    ).toThrow();
    expect(() =>
      LongCharacterFocusSnapshotSchema.parse({
        ...character,
        currentDocument: { ...character.currentDocument, kind: "overview" }
      })
    ).toThrow(/overview/u);
    expect(LongWorldbuildingFocusSnapshotSchema.parse(world)).toEqual(world);
    expect(LongCharacterFocusSnapshotSchema.parse(character)).toEqual(
      character
    );
  });

  it("preserves legacy text snapshots and still validates their combined limits", () => {
    const oldWorld = {
      categoryTitle: world.categoryTitle,
      format: world.format,
      currentStage: {
        kind: "item",
        title: "守夜人",
        text: { content: "宵禁。" }
      },
      overview: { content: "势力概览。" }
    };
    const oldCharacter = {
      characterName: character.characterName,
      group: character.group,
      currentDocument: {
        kind: "relationships",
        title: "人物关系",
        text: { content: "暂时合作。" }
      },
      overview: { content: "人物概览。" },
      coreProfile: { content: "核心档案。" }
    };
    expect(LongWorldbuildingFocusSnapshotSchema.parse(oldWorld)).toEqual(
      oldWorld
    );
    expect(LongCharacterFocusSnapshotSchema.parse(oldCharacter)).toEqual(
      oldCharacter
    );
    expect(() =>
      LongWorldbuildingFocusSnapshotSchema.parse({
        ...oldWorld,
        overview: { content: "界".repeat(20_000) }
      })
    ).toThrow(/maximum character count/u);
    expect(() =>
      LongCharacterFocusSnapshotSchema.parse({
        ...oldCharacter,
        coreProfile: { content: "界".repeat(20_000) }
      })
    ).toThrow(/maximum character count/u);
  });
});
