import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";

export interface SearchTarget {
  id: string;
  document?: string;
  chapter_id?: string;
}

export function longSearchTargets(
  index: LongWorkspaceIndexSnapshot
): Map<string, SearchTarget> {
  const targets = new Map<string, SearchTarget>();
  targets.set(index.bookLine.id, { id: "book_line" });
  if (index.characterOverview)
    targets.set(index.characterOverview.id, { id: "character_overview" });
  for (const category of index.worldbuilding) {
    if (category.format === "text")
      targets.set(category.file.id, { id: category.id });
    else {
      if (category.overview)
        targets.set(category.overview.id, { id: category.id });
      for (const item of category.items)
        targets.set(item.file.id, { id: item.id });
    }
  }
  for (const character of index.characterFiles) {
    targets.set(character.coreProfile.id, {
      id: character.characterId,
      document: "core_profile"
    });
    targets.set(character.relationships.id, {
      id: character.characterId,
      document: "relationships"
    });
  }
  for (const plot of index.plot.storyPlots)
    targets.set(plot.file.id, { id: plot.id });
  for (const chapter of index.chapters) {
    for (const [document, file] of Object.entries({
      card: chapter.card,
      body: chapter.body,
      character_state: chapter.characterState,
      handoff: chapter.handoff,
      foreshadowing_changes: chapter.foreshadowingChanges,
      world_reveals: chapter.worldReveals
    })) {
      if (file) targets.set(file.id, { id: chapter.chapterCardId, document });
    }
    for (const character of chapter.characterContinuity) {
      targets.set(character.currentState.id, {
        id: character.characterId,
        document: "current_state",
        chapter_id: chapter.chapterCardId
      });
      targets.set(character.history.id, {
        id: character.characterId,
        document: "history",
        chapter_id: chapter.chapterCardId
      });
    }
  }
  return targets;
}
