import {
  LONG_BUILTIN_CHARACTER_TYPE_IDS,
  type LongMaterialSourceStats
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import {
  decompositionCompleted,
  findDecompositionJob
} from "./decomposition-source";
import type { LongMaterialPackService } from "./service";
import { openLongBook, orderedChapters } from "./source-reader";

/** Counts from the book index only; no document is read. */
export async function inspectLongMaterialSource(
  service: LongMaterialPackService,
  longs: LongWorkspaceService,
  workspaceDirectory: string,
  bookId: string
): Promise<LongMaterialSourceStats> {
  const book = await openLongBook(longs, bookId);
  const { index } = book;
  const chapters = orderedChapters(index);
  const group = (id: string) =>
    index.characters.filter((character) => character.group === id).length;
  const builtin = new Set<string>(LONG_BUILTIN_CHARACTER_TYPE_IDS);
  const found = await findDecompositionJob(workspaceDirectory, bookId);
  return {
    bookId: book.bookId,
    title: book.title,
    genre: book.genre,
    worldCategories: index.worldbuilding.length,
    worldItems: index.worldbuilding.reduce(
      (total, category) =>
        total + (category.format === "list" ? category.items.length : 0),
      0
    ),
    characters: {
      protagonist: group("protagonist"),
      major: group("major_supporting"),
      minor: group("minor_supporting"),
      passerby: group("passerby"),
      other: index.characters.filter(({ group: id }) => !builtin.has(id)).length
    },
    volumes: index.plot.volumes.length,
    arcs: index.plot.arcs.length,
    chapterCards: index.plot.chapterCards.length,
    writtenChapters: chapters.filter(({ written }) => written).length,
    foreshadowing: index.plot.foreshadowing.length,
    storyEvents: index.plot.storyEvents.length,
    chapters: chapters.map(({ card, number, written }) => ({
      id: card.id,
      number,
      title: card.title.slice(0, 256),
      written
    })),
    ...(found
      ? {
          decomposition: {
            jobId: found.job.id,
            completed: decompositionCompleted(found.job),
            hasStyle: found.job.units["style:profile"]?.status === "done"
          }
        }
      : {}),
    packs: await service.summaries(bookId)
  };
}
