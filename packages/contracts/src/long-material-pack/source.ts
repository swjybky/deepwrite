import { z } from "zod";
import type { MaterialKind, MaterialStageId } from "../catalog";
import { firstLine } from "./markdown";

/**
 * Plain data Core reads from one long book before planning entries. It never
 * crosses IPC, so it is described by types only; ids are kept for stable
 * entry keys and never written into entry text.
 */
export type LongMaterialCharacterTier =
  "protagonist" | "major" | "minor" | "passerby";

export interface LongMaterialSourceCharacter {
  id: string;
  name: string;
  aliases: string[];
  tier: LongMaterialCharacterTier;
  typeTitle: string;
  coreProfile: string;
  relationships: string;
  history: string;
  currentState: string;
}

export interface LongMaterialSourceWorldCategory {
  id: string;
  title: string;
  overview: string;
  items: { id: string; title: string; content: string }[];
}

export interface LongMaterialSourceVolume {
  id: string;
  number: number;
  title: string;
  summary: string;
}

export interface LongMaterialSourceArc {
  id: string;
  volumeId: string;
  title: string;
  summary: string;
  outline: string;
  storyPlots: { title: string; content: string }[];
}

export interface LongMaterialSourceChapter {
  id: string;
  number: number;
  volumeId: string;
  arcId: string | null;
  title: string;
  card: string;
  written: boolean;
}

export interface LongMaterialSourceForeshadowing {
  title: string;
  coreQuestion: string;
  hiddenTruth: string;
  expectedReaderEffect: string;
  span: string;
  status: string;
  beats: {
    type: string;
    status: string;
    chapter: number | null;
    anchor: string;
    note: string;
  }[];
}

export interface LongMaterialSourceEvent {
  title: string;
  summary: string;
  time: string;
  location: string;
  arcs: string[];
  characters: string[];
}

export interface LongMaterialSourceSample {
  chapterId: string;
  number: number;
  title: string;
  body: string;
}

export interface LongMaterialSourceTopic {
  key: string;
  kind: Exclude<MaterialKind, "gimmick" | "other">;
  stageId: MaterialStageId;
  title: string;
  content: string;
}

export interface LongMaterialSource {
  bookId: string;
  title: string;
  genre: string;
  bookLine: string;
  characterOverview: string;
  worldbuilding: LongMaterialSourceWorldCategory[];
  characters: LongMaterialSourceCharacter[];
  volumes: LongMaterialSourceVolume[];
  arcs: LongMaterialSourceArc[];
  chapters: LongMaterialSourceChapter[];
  foreshadowing: LongMaterialSourceForeshadowing[];
  events: LongMaterialSourceEvent[];
  connections: { source: string; target: string; type: string; note: string }[];
  samples: LongMaterialSourceSample[];
  decomposition?: {
    completed: boolean;
    style?: {
      content: string;
      excerpts: { chapterOrder: number; text: string; comment: string }[];
    };
    topics: LongMaterialSourceTopic[];
  };
}

/** Book facts the guide quotes; kept in the record for guide-only rewrites. */
export const LongMaterialBookStatsSchema = z
  .object({
    genre: z.string().max(120),
    /** First line of the book line, quoted as the one-line pitch. */
    logline: z.string().max(200),
    chapters: z.number().int().nonnegative(),
    writtenChapters: z.number().int().nonnegative(),
    volumes: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    protagonists: z.number().int().nonnegative(),
    majorCharacters: z.number().int().nonnegative(),
    minorCharacters: z.number().int().nonnegative(),
    passerby: z.number().int().nonnegative(),
    worldCategories: z.number().int().nonnegative(),
    worldItems: z.number().int().nonnegative(),
    foreshadowing: z.number().int().nonnegative(),
    decomposition: z.enum(["none", "completed", "incomplete"]),
    styleSource: z.enum(["none", "decomposition", "guide"])
  })
  .strict();
export type LongMaterialBookStats = z.infer<typeof LongMaterialBookStatsSchema>;

export function longMaterialBookStats(
  source: LongMaterialSource
): LongMaterialBookStats {
  const tier = (value: LongMaterialCharacterTier) =>
    source.characters.filter((character) => character.tier === value).length;
  return {
    genre: source.genre,
    logline: firstLine(source.bookLine, 120),
    chapters: source.chapters.length,
    writtenChapters: source.chapters.filter(({ written }) => written).length,
    volumes: source.volumes.length,
    characters: source.characters.length,
    protagonists: tier("protagonist"),
    majorCharacters: tier("major"),
    minorCharacters: tier("minor"),
    passerby: tier("passerby"),
    worldCategories: source.worldbuilding.length,
    worldItems: source.worldbuilding.reduce(
      (total, { items }) => total + items.length,
      0
    ),
    foreshadowing: source.foreshadowing.length,
    decomposition: !source.decomposition
      ? "none"
      : source.decomposition.completed
        ? "completed"
        : "incomplete",
    styleSource: source.decomposition?.style ? "decomposition" : "none"
  };
}
