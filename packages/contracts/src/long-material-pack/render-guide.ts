import type { MaterialKind } from "../catalog";
import {
  composeEntry,
  composeParts,
  entryRef,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import type { LongMaterialGuideSubmission } from "./guide";
import { LONG_MATERIAL_INDEX_MAX_CHARACTERS } from "./limits";
import { nestHeadings } from "./markdown";
import { guideStyle, renderStyle } from "./render-draft";
import type { LongMaterialBookStats } from "./source";

export interface LongMaterialIndexEntry {
  key: string;
  kind: MaterialKind;
  title: string;
  description: string;
}

const SECTION_ORDER: { kind: MaterialKind; label: string }[] = [
  { kind: "plot", label: "剧情" },
  { kind: "character", label: "人设" },
  { kind: "gimmick", label: "梗" },
  { kind: "draft", label: "正文" },
  { kind: "other", label: "世界观" }
];

/** Families listed as one line in the guide instead of entry by entry. */
const COMPACT: { prefix: string; label: string; search: string }[] = [
  { prefix: "chapters:", label: "章纲", search: "“章纲·第2卷”或“第37章”" },
  { prefix: "sample:", label: "范文", search: "“范文·第1章”" },
  { prefix: "minor:", label: "次要人物群像", search: "人物名字" },
  { prefix: "outline:", label: "剧情点细纲", search: "“细纲·第2卷”" }
];

function brief(description: string, length: number): string {
  const text = description.replace(/^《[^》]*》的?/u, "");
  return length && text
    ? `：${text.length > length ? `${text.slice(0, length - 1)}…` : text}`
    : "";
}

function catalogLines(
  context: LongMaterialRenderContext,
  entries: readonly LongMaterialIndexEntry[],
  descriptionLength: number
): string[] {
  return SECTION_ORDER.flatMap(({ kind, label }) => {
    const own = entries.filter((entry) => entry.kind === kind);
    if (!own.length) return [];
    const lines: string[] = [];
    const listed = new Set<string>();
    for (const entry of own) {
      const family = COMPACT.find(({ prefix }) => entry.key.startsWith(prefix));
      if (!family) {
        lines.push(
          `- ${entryRef(context, kind, entry.title)}${brief(entry.description, descriptionLength)}`
        );
      } else if (!listed.has(family.prefix)) {
        listed.add(family.prefix);
        const members = own.filter(({ key }) => key.startsWith(family.prefix));
        lines.push(
          `- ${family.label}共 ${members.length} 条，从${entryRef(context, kind, members[0]!.title)}到「${members.at(-1)!.title}」；可搜索${family.search}定位`
        );
      }
    }
    return [
      `### ${label}（${context.libraryTitles[kind]}）\n\n${lines.join("\n")}`
    ];
  });
}

const ROUTES = [
  "| 任务 | 先读 | 再按需读 |",
  "| --- | --- | --- |",
  "| 设计世界观 | 世界观总览 | 世界观·〈类别〉 |",
  "| 设计人物 | 人物总览与关系网、人设功能位 | 人物·〈名〉、次要人物群像 |",
  "| 规划主线与分卷 | 仿写指南、全书主线、核心梗、金手指与卖点 | 分卷·第 N 卷 |",
  "| 写细纲、章纲 | 对应的分卷与细纲 | 章纲·第 N 卷·第 a–b 章（节奏参照） |",
  "| 设计伏笔 | 伏笔线 | 相关章纲 |",
  "| 写正文 | 文风画像 | 1–2 篇范文、典型片段与点评 |",
  "| 查具体人名或设定 | — | 用 search 搜索关键词 |"
].join("\n");

export function renderBookGuide(
  context: LongMaterialRenderContext,
  stats: LongMaterialBookStats,
  entries: readonly LongMaterialIndexEntry[],
  guideGenerated: boolean
): LongMaterialPlannedEntry {
  const book = context.bookTitle;
  const style = {
    none: "未生成（可运行仿写增强补上）",
    decomposition: "来自整书拆解记录",
    guide: "由仿写增强生成"
  }[stats.styleSource];
  const origin = {
    none: "非整书拆解生成",
    completed: "整书拆解已完成",
    incomplete: "整书拆解尚未完成，内容可能不完整"
  }[stats.decomposition];
  const overview = [
    `- 类型：${stats.genre || "未设置"} · ${stats.volumes} 卷 · ${stats.chapters} 章（已写正文 ${stats.writtenChapters} 章）`,
    ...(stats.logline ? [`- 一句话：${stats.logline}`] : []),
    `- 规模：人物 ${stats.characters}（主角 ${stats.protagonists}、主要配角 ${stats.majorCharacters}、次要配角 ${stats.minorCharacters}、路人 ${stats.passerby}）；世界观 ${stats.worldCategories} 类 ${stats.worldItems} 条；伏笔线 ${stats.foreshadowing} 条`,
    `- 完成度：${origin}；文风画像${style}；仿写指南${guideGenerated ? "已生成" : "未生成（可在“长篇转素材库”页面运行仿写增强）"}`
  ].join("\n");
  let result: LongMaterialPlannedEntry | undefined;
  for (const length of [40, 20, 0]) {
    result = composeEntry(context, {
      key: "guide",
      kind: "plot",
      stageId: "pacing",
      title: "全书导读",
      description: `先读这一条：《${book}》仿写素材总索引，含作品概况、五个素材库的全部条目目录、按创作阶段的读取路线与仿写边界。`,
      scope: `长篇 · 第 1–${stats.chapters} 章`,
      sections: [
        `这里是《${book}》仿写素材的总索引。条目用「库名 · 条目名」写出，可直接按这个名称读取。`,
        `## 作品概况\n\n${overview}`,
        `## 条目目录\n\n${catalogLines(context, entries, length).join("\n\n")}`,
        `## 读取路线\n\n${ROUTES}`,
        [
          "## 仿写边界",
          `- 以上是《${book}》的设计，不是当前作品的设定。除非用户明确要求同人或续写，不要把原作的人名、地名、专有设定写进新作品。`,
          "- 学的是结构、节奏、人物功能和爽点机制；题材表层、专有名词和具体桥段要替换。",
          "- 不复制原文句子，范文与片段只用来体会语感。"
        ].join("\n")
      ]
    });
    if (result.body.length <= LONG_MATERIAL_INDEX_MAX_CHARACTERS) break;
  }
  return result!;
}

/** Entries written from one guide submission; keys stay `enhance:*`. */
export function renderGuideEntries(
  context: LongMaterialRenderContext,
  submission: LongMaterialGuideSubmission,
  include: { gimmick: boolean; style: boolean }
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  const part = (
    key: string,
    kind: MaterialKind,
    stageId: LongMaterialPlannedEntry["stageId"],
    title: string,
    description: string,
    text: string
  ) =>
    composeParts(context, {
      key: `enhance:${key}`,
      kind,
      stageId,
      title,
      scope: "仿写增强",
      description: () => description,
      sections: [nestHeadings(text, 1)]
    }).map((entry) => ({ ...entry, enhanced: true }));
  const style = include.style ? guideStyle(submission) : undefined;
  return [
    ...part(
      "guide",
      "plot",
      "pacing",
      "仿写指南",
      `《${book}》仿写指南：结构模板、分卷功能、爽点节拍、章末钩子，以及可迁移的骨架与必须替换的表层；规划新作品前先读。`,
      submission.guide
    ),
    ...part(
      "roles",
      "character",
      "character",
      "人设功能位",
      `《${book}》人设功能位：原作人物各自承担的功能、可迁移的性格与关系张力、需替换的表层；设计新作人物时读。`,
      submission.roles
    ),
    ...part(
      "hooks",
      "gimmick",
      "gimmick",
      "爽点与钩子模式",
      `《${book}》爽点与钩子模式：爽点类型、触发结构与兑现节奏；设计情节高潮与章末钩子时读。`,
      submission.hooks
    ),
    ...part(
      "opening",
      "plot",
      "intro",
      "开篇拆解",
      `《${book}》开篇拆解：前三章的开场钩子、信息投放顺序、金手指出现时机与第一个小高潮；写开篇时读。`,
      submission.opening
    ),
    ...(include.gimmick && submission.gimmick
      ? part(
          "gimmick",
          "gimmick",
          "gimmick",
          "核心梗、金手指与卖点",
          `《${book}》的核心梗、金手指与卖点（仿写增强归纳）；构思同类作品的卖点时先读。`,
          submission.gimmick
        )
      : []),
    ...(style ? renderStyle(context, style, true) : [])
  ];
}

const LIBRARY_LEADS: Record<MaterialKind, (book: string) => string> = {
  character: (book) =>
    `本库存放《${book}》的人物设计：人物总览、主要人物档案与次要人物群像。`,
  gimmick: (book) => `本库存放《${book}》的核心梗、金手指、卖点与爽点模式。`,
  plot: (book) =>
    `本库存放《${book}》的剧情设计：全书导读、主线、分卷、细纲、章纲与伏笔线。`,
  draft: (book) => `本库存放《${book}》的文风画像、典型片段与精选范文。`,
  other: (book) =>
    `本库存放《${book}》的世界观设定：规则、势力、地理、境界等类别的概览与条目。`
};

/** The human-facing index block inside one library's introduction. */
export function renderLibraryOverview(
  kind: MaterialKind,
  book: string,
  entries: readonly LongMaterialIndexEntry[]
): string {
  return [
    LIBRARY_LEADS[kind](book),
    `以下 ${entries.length} 条由“长篇转素材库”生成，再次转换会原地更新：`,
    entries
      .map(({ title, description }) => `- ${title}${brief(description, 40)}`)
      .join("\n")
  ].join("\n\n");
}
