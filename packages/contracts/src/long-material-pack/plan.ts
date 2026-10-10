import { MATERIAL_KINDS, type MaterialKind } from "../catalog/kinds";
import type {
  LongMaterialPlannedEntry,
  LongMaterialRenderContext
} from "./entry";
import type { LongMaterialGuideSubmission } from "./guide";
import type { LongMaterialPackOptions } from "./options";
import { renderCharacters } from "./render-characters";
import {
  chaptersPerEntry,
  renderChapters,
  renderForeshadowing,
  renderTimeline
} from "./render-chapters";
import {
  decompositionStyle,
  renderSamples,
  renderStyle,
  renderTopics
} from "./render-draft";
import {
  renderBookGuide,
  renderGuideEntries,
  type LongMaterialIndexEntry
} from "./render-guide";
import { renderBookLine, renderOutlines, renderVolumes } from "./render-plot";
import { renderWorld } from "./render-world";
import {
  longMaterialBookStats,
  type LongMaterialBookStats,
  type LongMaterialSource
} from "./source";

export type { LongMaterialPlannedEntry } from "./entry";
export type { LongMaterialIndexEntry } from "./render-guide";
export { renderGuideEntries, renderLibraryOverview } from "./render-guide";
export { containsInternalId } from "./markdown";
export { splitGimmick } from "./render-plot";

export interface LongMaterialPlanInput {
  source: LongMaterialSource;
  options: LongMaterialPackOptions;
  libraryTitles: Readonly<Record<MaterialKind, string>>;
  /** Kept from the first conversion so 章纲 entries update in place. */
  chaptersPerEntry?: number | undefined;
  /** The saved guide run; its entries are rebuilt with every conversion. */
  guide?: LongMaterialGuideSubmission;
}

export interface LongMaterialPlan {
  /** Every entry, base and enhanced, in library order. */
  entries: LongMaterialPlannedEntry[];
  chaptersPerEntry: number;
  stats: LongMaterialBookStats;
}

const RANK: Record<string, number> = {
  guide: 0,
  "enhance:guide": 1,
  "book-line": 2,
  volume: 3,
  outline: 4,
  chapters: 5,
  foreshadowing: 6,
  timeline: 7,
  "enhance:opening": 8,
  characters: 0,
  "enhance:roles": 1,
  character: 2,
  minor: 3,
  gimmick: 0,
  "enhance:gimmick": 1,
  "enhance:hooks": 2,
  style: 0,
  "enhance:style": 1,
  "style-excerpts": 2,
  "enhance:style-excerpts": 3,
  sample: 4,
  world: 1,
  "world-item": 1
};

/** Rank of a key inside its library; equal ranks keep generation order. */
export function longMaterialKeyRank(key: string): number {
  if (key === "world:index") return 0;
  const [head, second] = key.split(":");
  const family = head === "enhance" ? `enhance:${second}` : head!;
  return RANK[family] ?? 9;
}

function names(source: LongMaterialSource): Map<string, string> {
  const map = new Map<string, string>();
  for (const { id, name } of source.characters) map.set(id, name);
  for (const category of source.worldbuilding) {
    map.set(category.id, category.title);
    for (const item of category.items) map.set(item.id, item.title);
  }
  for (const volume of source.volumes)
    map.set(volume.id, `第${volume.number}卷 ${volume.title}`.trim());
  for (const arc of source.arcs) map.set(arc.id, arc.title);
  for (const chapter of source.chapters)
    map.set(chapter.id, `第${chapter.number}章 ${chapter.title}`.trim());
  return map;
}

function uniqueTitles(
  entries: LongMaterialPlannedEntry[],
  reserved: Iterable<string>
): LongMaterialPlannedEntry[] {
  const used = new Set(reserved);
  return entries.map((entry) => {
    let title = entry.title;
    for (let suffix = 2; used.has(title); suffix++)
      title = `${entry.title} ${suffix}`;
    used.add(title);
    return title === entry.title
      ? entry
      : {
          ...entry,
          title,
          body: entry.body.replace(`# ${entry.title}\n`, `# ${title}\n`)
        };
  });
}

export function planLongMaterialPack(
  input: LongMaterialPlanInput
): LongMaterialPlan {
  const { source, options } = input;
  const context: LongMaterialRenderContext = {
    bookTitle: source.title,
    libraryTitles: input.libraryTitles,
    names: names(source)
  };
  const has = (section: LongMaterialPackOptions["sections"][number]) =>
    options.sections.includes(section);
  const perEntry = chaptersPerEntry(source, options, input.chaptersPerEntry);
  const style = has("style") ? decompositionStyle(source) : undefined;
  const topicKinds = new Set([
    ...(has("characters") ? ["character"] : []),
    ...(has("plot") ? ["plot"] : []),
    ...(has("style") ? ["draft"] : [])
  ]);
  const base = uniqueTitles(
    [
      ...(has("plot")
        ? [
            ...renderBookLine(context, source),
            ...renderVolumes(context, source),
            ...renderOutlines(context, source)
          ]
        : []),
      ...(has("chapters") ? renderChapters(context, source, perEntry) : []),
      ...(has("foreshadowing") ? renderForeshadowing(context, source) : []),
      ...(has("timeline") ? renderTimeline(context, source) : []),
      ...(has("characters") ? renderCharacters(context, source, options) : []),
      ...(style ? renderStyle(context, style, false) : []),
      ...(has("style") ? renderSamples(context, source) : []),
      ...(has("worldbuilding") ? renderWorld(context, source) : []),
      ...renderTopics(context, source, topicKinds)
    ],
    ["全书导读", "仿写指南", "人设功能位", "爽点与钩子模式", "开篇拆解"]
  );
  const enhanced = input.guide
    ? renderGuideEntries(context, input.guide, {
        gimmick: !base.some(({ key }) => key.startsWith("gimmick:")),
        style: !base.some(({ key }) => key.startsWith("style:"))
      })
    : [];
  const stats = longMaterialBookStats(source);
  if (
    stats.styleSource === "none" &&
    enhanced.some(({ key }) => key.startsWith("enhance:style:"))
  )
    stats.styleSource = "guide";
  const kindIndex = (kind: MaterialKind) => MATERIAL_KINDS.indexOf(kind);
  const sort = <T extends { key: string; kind: MaterialKind }>(values: T[]) =>
    values
      .map((value, index) => ({ value, index }))
      .sort(
        (a, b) =>
          kindIndex(a.value.kind) - kindIndex(b.value.kind) ||
          longMaterialKeyRank(a.value.key) - longMaterialKeyRank(b.value.key) ||
          a.index - b.index
      )
      .map(({ value }) => value);
  const all = sort([...base, ...enhanced]);
  const listed: LongMaterialIndexEntry[] = all.map(
    ({ key, kind, title, description }) => ({ key, kind, title, description })
  );
  const guide = renderBookGuide(context, stats, listed, Boolean(input.guide));
  return {
    entries: sort([guide, ...all]),
    chaptersPerEntry: perEntry,
    stats
  };
}
