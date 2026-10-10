import {
  composeParts,
  entryRef,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import { chapterRange, cleanText, nestHeadings } from "./markdown";
import type { LongMaterialSource } from "./source";

const GIMMICK_HEADING = /^(#{1,6})\s*\S*?(?:核心梗|金手指|卖点)/u;

/** Moves "核心梗/金手指/卖点" sections of the book line into their own text. */
export function splitGimmick(bookLine: string): {
  line: string;
  gimmick: string;
} {
  const lines = cleanText(bookLine).split("\n");
  const kept: string[] = [];
  const taken: string[] = [];
  let level = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s/u.exec(line);
    if (heading && level && heading[1]!.length <= level) level = 0;
    const gimmick = GIMMICK_HEADING.exec(line);
    if (gimmick && !level) level = gimmick[1]!.length;
    (level ? taken : kept).push(line);
  }
  return {
    line: cleanText(kept.join("\n")),
    gimmick: cleanText(taken.join("\n"))
  };
}

export function volumeRange(
  source: LongMaterialSource,
  predicate: (chapter: LongMaterialSource["chapters"][number]) => boolean
): string {
  const numbers = source.chapters.filter(predicate).map(({ number }) => number);
  return numbers.length
    ? chapterRange(Math.min(...numbers), Math.max(...numbers))
    : "";
}

export function renderBookLine(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  const { line, gimmick } = splitGimmick(source.bookLine);
  const book = context.bookTitle;
  return [
    ...(line
      ? composeParts(context, {
          key: "book-line",
          kind: "plot",
          stageId: "pacing",
          title: "全书主线",
          scope: "全书主线",
          description: (part, count) =>
            `《${book}》全书主线${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：主角目标、阶段转折、冲突升级与结局走向；规划主线与分卷时读。`,
          sections: [
            nestHeadings(line, 1),
            ...(gimmick
              ? [
                  `核心梗、金手指与卖点见${entryRef(context, "gimmick", "核心梗、金手指与卖点")}。`
                ]
              : [])
          ]
        })
      : []),
    ...(gimmick
      ? composeParts(context, {
          key: "gimmick",
          kind: "gimmick",
          stageId: "gimmick",
          title: "核心梗、金手指与卖点",
          scope: "全书主线中的核心梗与卖点",
          description: () =>
            `《${book}》的核心梗、金手指与卖点；构思同类作品的卖点与主角优势时先读。`,
          sections: [nestHeadings(gimmick, 1)]
        })
      : [])
  ];
}

export function renderVolumes(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  return source.volumes.flatMap((volume) => {
    const arcs = source.arcs.filter((arc) => arc.volumeId === volume.id);
    const range = volumeRange(source, (c) => c.volumeId === volume.id);
    const plotPoints = arcs.map((arc, index) => {
      const arcRange = volumeRange(source, (c) => c.arcId === arc.id);
      return `### ${index + 1}. ${arc.title}${arcRange ? `（${arcRange}）` : ""}${cleanText(arc.summary) ? `\n\n${nestHeadings(arc.summary, 3)}` : ""}`;
    });
    const sections = [
      ...(cleanText(volume.summary)
        ? [`## 卷梗概\n\n${nestHeadings(volume.summary, 2)}`]
        : []),
      ...(plotPoints.length ? [`## 剧情点\n\n${plotPoints.join("\n\n")}`] : [])
    ];
    if (!sections.length) return [];
    const title = `分卷·第${volume.number}卷 ${volume.title}`.trim();
    return composeParts(context, {
      key: `volume:${volume.id}`,
      kind: "plot",
      stageId: "plot_refine",
      title,
      scope: `第${volume.number}卷${range ? ` · ${range}` : ""}`,
      description: (part, count) =>
        `《${book}》第${volume.number}卷「${volume.title}」${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：卷梗概与 ${arcs.length} 个剧情点${range ? `（${range}）` : ""}；规划同类分卷时读。`,
      sections
    });
  });
}

export function renderOutlines(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  return source.volumes.flatMap((volume) => {
    const sections = source.arcs
      .filter((arc) => arc.volumeId === volume.id)
      .filter(
        (arc) =>
          cleanText(arc.outline) ||
          arc.storyPlots.some(({ content }) => cleanText(content))
      )
      .map((arc) => {
        const arcRange = volumeRange(source, (c) => c.arcId === arc.id);
        return [
          `## 剧情点：${arc.title}${arcRange ? `（${arcRange}）` : ""}`,
          ...(cleanText(arc.outline) ? [nestHeadings(arc.outline, 2)] : []),
          ...arc.storyPlots
            .filter(({ content }) => cleanText(content))
            .map(
              ({ title, content }) =>
                `### 情节：${title}\n\n${nestHeadings(content, 3)}`
            )
        ].join("\n\n");
      });
    if (!sections.length) return [];
    return composeParts(context, {
      key: `outline:${volume.id}`,
      kind: "plot",
      stageId: "plot_refine",
      title: `细纲·第${volume.number}卷 ${volume.title}`.trim(),
      scope: `第${volume.number}卷 · 剧情点细纲`,
      description: (part, count) =>
        `《${book}》第${volume.number}卷剧情点细纲${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：每个剧情点的大纲与情节链；写同类细纲时读。`,
      sections
    });
  });
}
