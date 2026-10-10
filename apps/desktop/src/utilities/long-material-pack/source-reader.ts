import {
  latestCommittedContinuityChapter,
  type LongMarkdownFileReference,
  type LongMaterialCharacterTier,
  type LongMaterialSource,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { readSecureTextFile } from "../long-project-store/io";
import type { LongWorkspaceService } from "../long-workspace-service";
import { readDecompositionMaterial } from "./decomposition-source";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const READ_CONCURRENCY = 16;

export interface OpenedLongBook {
  projectDirectory: string;
  bookId: string;
  title: string;
  genre: string;
  index: LongWorkspaceIndexSnapshot;
}

export async function openLongBook(
  longs: LongWorkspaceService,
  bookId: string
): Promise<OpenedLongBook> {
  const opened = await longs.catalog.open(bookId);
  return {
    projectDirectory: opened.projectDirectory,
    bookId: opened.book.id,
    title: opened.book.title,
    genre: opened.book.genre,
    index: opened.book.workspaceIndex
  };
}

/** Chapters in reading order: volume order, then narrative order. */
export function orderedChapters(index: LongWorkspaceIndexSnapshot) {
  const volumeOrder = new Map(index.plot.volumes.map((v) => [v.id, v.order]));
  const files = new Map(
    index.chapters.map((entry) => [entry.chapterCardId, entry])
  );
  return [...index.plot.chapterCards]
    .sort(
      (a, b) =>
        (volumeOrder.get(a.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(b.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        a.narrativeOrder - b.narrativeOrder ||
        a.id.localeCompare(b.id)
    )
    .map((card, position) => ({
      card,
      number: position + 1,
      files: files.get(card.id),
      written: files.get(card.id)?.bodyStatus === "written"
    }));
}

export function characterTier(group: string): LongMaterialCharacterTier {
  if (group === "protagonist") return "protagonist";
  if (group === "major_supporting") return "major";
  if (group === "passerby") return "passerby";
  return "minor";
}

/** Reads index-referenced Markdown with bounded parallelism; missing is empty. */
export function createFileReader(projectDirectory: string) {
  return async function read(
    refs: readonly (LongMarkdownFileReference | undefined | null)[]
  ): Promise<string[]> {
    const result: string[] = [];
    for (let start = 0; start < refs.length; start += READ_CONCURRENCY)
      result.push(
        ...(await Promise.all(
          refs.slice(start, start + READ_CONCURRENCY).map(async (ref) => {
            if (!ref) return "";
            try {
              return (
                await readSecureTextFile(
                  projectDirectory,
                  ref.path,
                  MAX_FILE_BYTES
                )
              ).content;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
              throw error;
            }
          })
        ))
      );
    return result;
  };
}

const ordered = <T extends { order: number; id: string }>(
  values: readonly T[]
) => [...values].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

/** Everything the planner needs from one long book; nothing is written. */
export async function readLongMaterialSource(
  longs: LongWorkspaceService,
  workspaceDirectory: string,
  bookId: string,
  sampleChapterIds: readonly string[],
  onProgress?: (done: number, total: number) => void
): Promise<LongMaterialSource> {
  const book = await openLongBook(longs, bookId);
  const { index } = book;
  const read = createFileReader(book.projectDirectory);
  const chapters = orderedChapters(index);
  const total = chapters.length + index.characters.length + 4;
  let done = 0;
  const step = (count: number) => {
    done += count;
    onProgress?.(Math.min(done, total), total);
  };
  const [bookLine, characterOverview] = await read([
    index.bookLine,
    index.characterOverview
  ]);
  const categories = ordered(index.worldbuilding);
  const worldbuilding = [];
  for (const category of categories) {
    if (category.format === "text") {
      const [overview] = await read([category.file]);
      worldbuilding.push({
        id: category.id,
        title: category.title,
        overview: overview!,
        items: []
      });
      continue;
    }
    const items = ordered(category.items);
    const [overview, ...contents] = await read([
      category.overview,
      ...items.map(({ file }) => file)
    ]);
    worldbuilding.push({
      id: category.id,
      title: category.title,
      overview: overview!,
      items: items.map((item, i) => ({
        id: item.id,
        title: item.title,
        content: contents[i]!
      }))
    });
  }
  step(2);
  const types = new Map(index.characterTypes.map((type) => [type.id, type]));
  const files = new Map(
    index.characterFiles.map((entry) => [entry.characterId, entry])
  );
  const people = [...index.characters].sort(
    (a, b) =>
      (types.get(a.group)?.order ?? 999) - (types.get(b.group)?.order ?? 999) ||
      a.order - b.order ||
      a.id.localeCompare(b.id)
  );
  const characters = [];
  for (const character of people) {
    const entry = files.get(character.id);
    const latest = latestCommittedContinuityChapter(index, (chapter) =>
      chapter.characterContinuity.some(
        ({ characterId }) => characterId === character.id
      )
    )?.characterContinuity.find(
      ({ characterId }) => characterId === character.id
    );
    const [coreProfile, relationships, history, currentState] = await read([
      entry?.coreProfile,
      entry?.relationships,
      latest?.history,
      latest?.currentState
    ]);
    characters.push({
      id: character.id,
      name: character.name,
      aliases: character.aliases,
      tier: characterTier(character.group),
      typeTitle: types.get(character.group)?.title ?? "其他人物",
      coreProfile: coreProfile!,
      relationships: relationships!,
      history: history!,
      currentState: currentState!
    });
    step(1);
  }
  const cards = await read(chapters.map(({ files }) => files?.card));
  step(chapters.length);
  const numberOf = new Map(
    chapters.map(({ card, number }) => [card.id, number])
  );
  const volumes = ordered(index.plot.volumes);
  const volumeNumber = new Map(volumes.map((volume, i) => [volume.id, i + 1]));
  const arcs = ordered(index.plot.arcs);
  const arcTitle = new Map(arcs.map((arc) => [arc.id, arc.title]));
  const storyPlots = ordered(index.plot.storyPlots);
  const plotTexts = await read(storyPlots.map(({ file }) => file));
  const eventTitle = new Map(
    index.plot.storyEvents.map((event) => [event.id, event.title])
  );
  const characterName = new Map(
    index.characters.map(({ id, name }) => [id, name])
  );
  const samples = chapters.filter(({ card }) =>
    sampleChapterIds.includes(card.id)
  );
  const bodies = await read(samples.map(({ files }) => files?.body));
  step(2);
  return {
    bookId: book.bookId,
    title: book.title,
    genre: book.genre,
    bookLine: bookLine!,
    characterOverview: characterOverview!,
    worldbuilding,
    characters,
    volumes: volumes.map((volume, i) => ({
      id: volume.id,
      number: i + 1,
      title: volume.title,
      summary: volume.summary
    })),
    arcs: arcs.map((arc) => ({
      id: arc.id,
      volumeId: arc.volumeId,
      title: arc.title,
      summary: arc.summary ?? "",
      outline: arc.outline,
      storyPlots: storyPlots
        .map((plot, i) => ({ plot, content: plotTexts[i]! }))
        .filter(({ plot }) => plot.arcId === arc.id)
        .map(({ plot, content }) => ({ title: plot.title, content }))
    })),
    chapters: chapters.map(({ card, number, written }, i) => ({
      id: card.id,
      number,
      volumeId: card.volumeId,
      arcId: card.primaryArcId,
      title: card.title,
      card: cards[i]!,
      written
    })),
    foreshadowing: index.plot.foreshadowing.map((line) => ({
      title: line.title,
      coreQuestion: line.coreQuestion,
      hiddenTruth: line.hiddenTruth ?? "",
      expectedReaderEffect: line.expectedReaderEffect,
      span: line.plannedSpan ?? "",
      status: line.status,
      beats: ordered(line.beats).map((beat) => ({
        type: beat.type,
        status: beat.status,
        chapter: beat.chapterCardId
          ? (numberOf.get(beat.chapterCardId) ?? null)
          : null,
        anchor: [
          beat.volumeId ? `第${volumeNumber.get(beat.volumeId) ?? "?"}卷` : "",
          beat.arcId ? (arcTitle.get(beat.arcId) ?? "") : "",
          beat.plannedScope
        ]
          .filter(Boolean)
          .join(" · "),
        note: beat.note
      }))
    })),
    events: [...index.plot.storyEvents]
      .sort((a, b) => a.storyOrder - b.storyOrder || a.id.localeCompare(b.id))
      .map((event) => ({
        title: event.title,
        summary: event.summary,
        time: event.timeLabel,
        location: event.location,
        arcs: event.arcIds.flatMap((id) => arcTitle.get(id) ?? []),
        characters: event.characterIds.flatMap(
          (id) => characterName.get(id) ?? []
        )
      })),
    connections: index.plot.eventConnections.map((connection) => ({
      source: eventTitle.get(connection.sourceEventId) ?? "未知事件",
      target: eventTitle.get(connection.targetEventId) ?? "未知事件",
      type: connection.type,
      note: connection.note
    })),
    samples: samples.map(({ card, number }, i) => ({
      chapterId: card.id,
      number,
      title: card.title,
      body: bodies[i]!
    })),
    ...(await readDecompositionMaterial(workspaceDirectory, bookId))
  };
}
