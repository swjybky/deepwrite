import {
  composeEntry,
  composeParts,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import {
  LONG_MATERIAL_INDEX_MAX_CHARACTERS,
  LONG_MATERIAL_WORLD_ITEM_SOLO_CHARACTERS
} from "./limits";
import { cleanText, firstLine, nestHeadings } from "./markdown";
import type { LongMaterialSource } from "./source";

function listNames(names: readonly string[], budget: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length + name.length + 1 > budget) break;
    kept.push(name);
    length += name.length + 1;
  }
  return kept.length < names.length
    ? `${kept.join("、")} 等 ${names.length} 条`
    : kept.join("、");
}

/** The world goes to the "other" library; every entry name says so. */
export function renderWorld(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  const categories = source.worldbuilding.filter(
    ({ overview, items }) =>
      cleanText(overview) || items.some(({ content }) => cleanText(content))
  );
  if (!categories.length) return [];
  const book = context.bookTitle;
  const perCategory = Math.max(
    120,
    Math.floor((LONG_MATERIAL_INDEX_MAX_CHARACTERS - 800) / categories.length)
  );
  const index = composeEntry(context, {
    key: "world:index",
    kind: "other",
    stageId: "other",
    title: "世界观总览",
    description: `《${book}》世界观总览：全部世界观类别与条目目录；设计世界观、力量体系或势力时先读，再按类别读取详情。`,
    scope: "世界观",
    sections: [
      `本库（“其他”库）存放《${book}》的世界观设定。下面列出全部类别；每个类别的完整内容见对应的「世界观·类别」条目。`,
      ...categories.map((category) => {
        const lead = firstLine(category.overview, 80);
        const items = category.items.map(({ title }) => title);
        return [
          `## ${category.title}`,
          ...(lead ? [lead] : []),
          ...(items.length
            ? [`条目：${listNames(items, perCategory - lead.length)}`]
            : [])
        ].join("\n\n");
      })
    ]
  });
  const entries: LongMaterialPlannedEntry[] = [index];
  for (const category of categories) {
    const solo = category.items.filter(
      ({ content }) =>
        cleanText(content).length > LONG_MATERIAL_WORLD_ITEM_SOLO_CHARACTERS
    );
    const inline = category.items.filter((item) => !solo.includes(item));
    const sections = [
      ...(cleanText(category.overview)
        ? [`## 概览\n\n${nestHeadings(category.overview, 2)}`]
        : []),
      ...inline
        .filter(({ content }) => cleanText(content))
        .map(
          ({ title, content }) => `## ${title}\n\n${nestHeadings(content, 2)}`
        ),
      ...solo.map(
        ({ title }) =>
          `## ${title}\n\n内容较长，单独成条：「世界观·${category.title}·${title}」。`
      )
    ];
    const names = category.items.map(({ title }) => title);
    entries.push(
      ...composeParts(context, {
        key: `world:${category.id}`,
        kind: "other",
        stageId: "other",
        title: `世界观·${category.title}`,
        scope: `世界观 · ${category.title}`,
        description: (part, count) =>
          `《${book}》世界观「${category.title}」${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：概览与条目${names.length ? `（${listNames(names, 50)}）` : ""}；设计同类设定时读。`,
        sections
      })
    );
    for (const item of solo)
      entries.push(
        ...composeParts(context, {
          key: `world-item:${item.id}`,
          kind: "other",
          stageId: "other",
          title: `世界观·${category.title}·${item.title}`,
          scope: `世界观 · ${category.title} · ${item.title}`,
          description: (part, count) =>
            `《${book}》世界观「${category.title}」中的「${item.title}」${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}完整设定；需要该设定细节时读。`,
          sections: [nestHeadings(item.content, 1)]
        })
      );
  }
  return entries;
}
