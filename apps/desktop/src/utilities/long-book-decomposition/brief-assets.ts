import { decompositionAssetProse } from "@deepwrite/contracts";
import type { BriefContext } from "./briefs";
import {
  chapterDigestSections,
  factLine,
  type BriefSection
} from "./brief-text";
import { sampleDecompositionPassages } from "./passage-sampling";

const TIERS: Record<string, string> = {
  protagonist: "主角",
  major_supporting: "主要配角",
  minor_supporting: "次要配角",
  passerby: "路人"
};

/** A character's mentions, or its saved volume biographies for the final dossier. */
export async function characterBriefs(
  context: BriefContext,
  unitId: string
): Promise<BriefSection[]> {
  const unit = context.job.units[unitId]!;
  const registryId = unit.biography
    ? unit.biography.registryId
    : unitId.slice("character:".length);
  const entry = (await context.registry()).characters.find(
    ({ id }) => id === registryId
  );
  if (!entry) throw new Error("名册人物不存在。");
  const names = new Set([entry.name, ...entry.aliases]);
  const range = unit.biography;
  const header = `【${unitId}】${entry.name}（${TIERS[entry.tier] ?? entry.tier}）｜registryId=${entry.id}｜别名：${entry.aliases.join("、") || "无"}｜首次第${entry.firstChapterOrder}章${range ? `｜${range.volume}：第${range.startOrder}–${range.endOrder}章` : ""}`;
  const mentions: string[] = [];
  for (const card of await context.cards()) {
    const order = card.chapters[0]?.order ?? 0;
    if (range && (order < range.startOrder || order > range.endOrder)) continue;
    for (const item of card.characters) {
      if (
        !names.has(item.name) &&
        !item.aliases.some((name) => names.has(name))
      )
        continue;
      if (item.role) mentions.push(`第${order}章 身份：${item.role}`);
      mentions.push(...item.facts.map(factLine));
      if (item.endState) mentions.push(`第${order}章 结束时：${item.endState}`);
    }
  }
  const biographies = range ? [] : unit.dependencies;
  if (!biographies.length)
    return [{ title: `${header}\n提及：`, lines: mentions }];
  const sections: BriefSection[] = [];
  for (const id of biographies) {
    const asset = await context.asset(id);
    if (asset)
      sections.push({
        title: `${id === biographies[0] ? `${header}\n` : ""}【已保存的分卷小传 ${id}】`,
        lines: [decompositionAssetProse(asset)],
        prose: true
      });
  }
  // Latest state still comes from the last mentions, not the biographies.
  sections.push({
    title: `【${entry.name} 最近的提及】`,
    lines: mentions.slice(-40)
  });
  return sections;
}

const REVIEW_PREFIXES: Record<string, string[]> = {
  character: ["character:"],
  world: ["world:"],
  plot: ["chronicle:", "plot:"],
  style: ["style:"],
  continuity: ["continuity:"]
};

async function assetSections(
  context: BriefContext,
  ids: readonly string[]
): Promise<BriefSection[]> {
  const sections: BriefSection[] = [];
  for (const id of ids) {
    const asset = await context.asset(id);
    if (asset)
      sections.push({
        title: `【${id}】`,
        lines: [decompositionAssetProse(asset)],
        prose: true
      });
  }
  return sections;
}

async function worldBrief(context: BriefContext, unitId: string) {
  const categoryId = unitId.slice("world:".length);
  const terms = (await context.registry()).terms.filter(
    (term) => term.categoryId === categoryId && !term.ignored
  );
  const names = new Map(
    terms.flatMap((term) =>
      [term.name, ...term.aliases].map((name) => [name, term.name] as const)
    )
  );
  const facts: string[] = [];
  for (const card of await context.cards())
    for (const item of card.world) {
      const name =
        names.get(item.name) ??
        (item.categoryId === categoryId ? item.name : undefined);
      if (name)
        facts.push(...item.facts.map((fact) => `［${name}］${factLine(fact)}`));
    }
  return [
    {
      title: `【${unitId} 名册条目】`,
      lines: terms.map(
        (term) =>
          `${term.name}｜别名：${term.aliases.join("、") || "无"}｜提及 ${term.mentionCount} 次`
      )
    },
    { title: "【设定提及】", lines: facts }
  ];
}

async function styleBrief(context: BriefContext): Promise<BriefSection[]> {
  const cards = await context.cards();
  const passages = (
    ["opening", "dialogue", "climax", "ending"] as const
  ).flatMap((strategy) =>
    sampleDecompositionPassages(context.chapters, strategy, cards).map(
      ({ chapterOrder, title, text }) =>
        `### 第${chapterOrder}章 ${title}（${strategy}）\n${text}`
    )
  );
  return [
    {
      title: "【文风观察】",
      lines: [...new Set(cards.flatMap(({ style }) => style.notes))]
    },
    {
      title: "【阅读时摘出的片段】",
      lines: cards.flatMap(({ style }) =>
        style.excerpts.map(
          ({ chapterOrder, text, why }) =>
            `第${chapterOrder}章：${text}（${why}）`
        )
      )
    },
    { title: "【抽样原文】", lines: [...new Set(passages)], prose: true }
  ];
}

async function continuityBrief(context: BriefContext, unitId: string) {
  const last = context.chapters.at(-1);
  const cards = (await context.cards()).slice(-2);
  return [
    ...(await assetSections(context, context.job.units[unitId]!.dependencies)),
    ...chapterDigestSections(cards, "【最后几章的阅读记录】").slice(0, 1),
    ...(last
      ? [
          {
            title: `【最新一章原文 第${last.order}章 ${last.title}】`,
            lines: [last.text],
            prose: true
          }
        ]
      : [])
  ];
}

async function reviewBrief(context: BriefContext, unitId: string) {
  const domain = unitId.slice("review:".length);
  const prefixes = REVIEW_PREFIXES[domain] ?? [];
  const ids = Object.keys(context.job.units).filter(
    (id) =>
      prefixes.some((prefix) => id.startsWith(prefix)) ||
      (id.startsWith("topic:") &&
        context.job.units[id]!.topic?.domain === domain)
  );
  const sections = await assetSections(context, ids);
  if (domain === "character") {
    const characters = (await context.registry()).characters.filter(
      ({ ignored, tier }) => !ignored && tier !== "passerby"
    );
    const active = characters.filter(
      ({ id }) => context.job.units[`character:${id}`]?.status !== "skipped"
    );
    const skipped = characters.filter(
      ({ id }) => context.job.units[`character:${id}`]?.status === "skipped"
    );
    if (skipped.length)
      sections.unshift({
        title: "【用户已跳过的人物（无需审校或修复）】",
        lines: skipped.map(
          ({ id, name, tier }) =>
            `character:${id}｜${name}｜${TIERS[tier] ?? tier}`
        )
      });
    sections.unshift({
      title: "【确认名册中的人物】",
      lines: active.map(
        ({ id, name, tier }) =>
          `character:${id}｜${name}｜${TIERS[tier] ?? tier}`
      )
    });
  }
  return sections;
}

/** World, style, continuity, review and topic units. */
export async function domainBriefs(
  context: BriefContext,
  unitId: string
): Promise<BriefSection[]> {
  if (unitId.startsWith("world:")) return worldBrief(context, unitId);
  if (unitId === "style:profile") return styleBrief(context);
  if (unitId.startsWith("continuity:")) return continuityBrief(context, unitId);
  if (unitId.startsWith("review:")) return reviewBrief(context, unitId);
  const unit = context.job.units[unitId]!;
  return [
    {
      title: `【专题 ${unitId}】`,
      lines: unit.topic
        ? [`领域：${unit.topic.domain}｜标题：${unit.topic.title}`]
        : []
    },
    ...(await assetSections(context, unit.dependencies)),
    ...chapterDigestSections(await context.cards(), "【全书章节梗概】").slice(
      0,
      1
    )
  ];
}
