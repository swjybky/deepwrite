import {
  composeParts,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import { LONG_MATERIAL_ENTRY_TARGET_CHARACTERS } from "./limits";
import {
  chapterLabel,
  chapterRange,
  cleanText,
  nestHeadings
} from "./markdown";
import type { LongMaterialPackOptions } from "./options";
import type { LongMaterialSource } from "./source";

const BEAT_TYPES: Record<string, string> = {
  plant: "埋设",
  reinforce: "加强",
  misdirect: "误导",
  partial_reveal: "部分揭示",
  reveal: "揭示",
  payoff: "回收",
  aftermath: "余波"
};
const BEAT_STATUS: Record<string, string> = {
  planned: "计划中",
  committed: "已发生",
  missed: "未兑现"
};
const LINE_STATUS: Record<string, string> = {
  planned: "计划中",
  open: "已埋下",
  progressing: "推进中",
  resolved: "已回收",
  abandoned: "已放弃"
};
const SPANS: Record<string, string> = {
  local: "局部",
  within_volume: "卷内",
  cross_volume: "跨卷"
};
const CONNECTIONS: Record<string, string> = {
  before: "早于",
  same_time: "同时",
  overlaps: "重叠",
  causes: "导致",
  enables: "促成",
  conceals: "掩盖"
};

/** Chapters per 章纲 entry: kept from the first conversion once chosen. */
export function chaptersPerEntry(
  source: LongMaterialSource,
  options: LongMaterialPackOptions,
  previous?: number
): number {
  if (previous) return previous;
  if (options.chapterGrouping !== "auto")
    return Number(options.chapterGrouping);
  const cards = source.chapters.map(({ card }) => cleanText(card).length + 40);
  const average = cards.length
    ? cards.reduce((total, value) => total + value, 0) / cards.length
    : 1;
  return Math.min(
    50,
    Math.max(5, Math.floor(LONG_MATERIAL_ENTRY_TARGET_CHARACTERS / average))
  );
}

export function renderChapters(
  context: LongMaterialRenderContext,
  source: LongMaterialSource,
  perEntry: number
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  return source.volumes.flatMap((volume) => {
    const chapters = source.chapters.filter((c) => c.volumeId === volume.id);
    const entries: LongMaterialPlannedEntry[] = [];
    for (let start = 0; start < chapters.length; start += perEntry) {
      const group = chapters.slice(start, start + perEntry);
      if (!group.some(({ card }) => cleanText(card))) continue;
      const range = chapterRange(group[0]!.number, group.at(-1)!.number);
      entries.push(
        ...composeParts(context, {
          key: `chapters:${volume.id}:${start / perEntry + 1}`,
          kind: "plot",
          stageId: "plot_refine",
          title: `章纲·第${volume.number}卷·${range}`,
          scope: `第${volume.number}卷 ${volume.title} · ${range}`.trim(),
          description: (part, count) =>
            `《${book}》第${volume.number}卷${range}逐章章纲${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：梗概、关键事件、出场人物与章末钩子；参照这一段节奏写细纲时读。`,
          sections: group.map(
            ({ number, title, card }) =>
              `## ${chapterLabel(number, title)}\n\n${cleanText(card) ? nestHeadings(card, 2) : "（本章没有章纲）"}`
          )
        })
      );
    }
    return entries;
  });
}

export function renderForeshadowing(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  if (!source.foreshadowing.length) return [];
  const book = context.bookTitle;
  return composeParts(context, {
    key: "foreshadowing",
    kind: "plot",
    stageId: "pacing",
    title: "伏笔线",
    scope: `伏笔线 · 共 ${source.foreshadowing.length} 条`,
    description: (part, count) =>
      `《${book}》伏笔线${count > 1 ? `第 ${part + 1}/${count} 篇` : `（${source.foreshadowing.length} 条）`}：核心悬念、真相、读者效果与埋设、回收的章号；设计伏笔时读。`,
    sections: source.foreshadowing.map((line) =>
      [
        `## ${line.title}`,
        [
          `- 状态：${LINE_STATUS[line.status] ?? line.status}${line.span ? ` · 跨度：${SPANS[line.span] ?? line.span}` : ""}`,
          ...(cleanText(line.coreQuestion)
            ? [`- 核心问题：${cleanText(line.coreQuestion)}`]
            : []),
          ...(cleanText(line.hiddenTruth)
            ? [`- 隐藏真相：${cleanText(line.hiddenTruth)}`]
            : []),
          ...(cleanText(line.expectedReaderEffect)
            ? [`- 读者效果：${cleanText(line.expectedReaderEffect)}`]
            : [])
        ].join("\n"),
        ...(line.beats.length
          ? [
              `触点：\n${line.beats
                .map(
                  (beat) =>
                    `- ${beat.chapter ? `第${beat.chapter}章` : beat.anchor || "未定位"} · ${BEAT_TYPES[beat.type] ?? beat.type} · ${BEAT_STATUS[beat.status] ?? beat.status}${cleanText(beat.note) ? `：${cleanText(beat.note)}` : ""}`
                )
                .join("\n")}`
            ]
          : [])
      ].join("\n\n")
    )
  });
}

export function renderTimeline(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  if (!source.events.length) return [];
  const book = context.bookTitle;
  const events = source.events.map((event) =>
    [
      `## ${event.title}`,
      [
        ...(event.time ? [`- 时间：${event.time}`] : []),
        ...(event.location ? [`- 地点：${event.location}`] : []),
        ...(event.arcs.length ? [`- 剧情点：${event.arcs.join("、")}`] : []),
        ...(event.characters.length
          ? [`- 人物：${event.characters.join("、")}`]
          : [])
      ].join("\n"),
      ...(cleanText(event.summary) ? [nestHeadings(event.summary, 2)] : [])
    ]
      .filter(Boolean)
      .join("\n\n")
  );
  const connections = source.connections.map(
    ({ source: from, target, type, note }) =>
      `- ${from} ${CONNECTIONS[type] ?? type} ${target}${cleanText(note) ? `：${cleanText(note)}` : ""}`
  );
  return composeParts(context, {
    key: "timeline",
    kind: "plot",
    stageId: "plot_refine",
    title: "故事时间线",
    scope: `故事时间线 · ${source.events.length} 个事件`,
    description: (part, count) =>
      `《${book}》故事时间线${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：按故事时间排列的事件、地点、人物与事件关系；理顺时间与因果时读。`,
    sections: [
      ...events,
      ...(connections.length
        ? [`## 事件关系\n\n${connections.join("\n")}`]
        : [])
    ]
  });
}
