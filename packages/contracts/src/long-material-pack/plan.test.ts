import { describe, expect, it } from "vitest";
import {
  LONG_MATERIAL_ENTRY_MAX_CHARACTERS,
  LONG_MATERIAL_INDEX_MAX_CHARACTERS
} from "./limits";
import { DEFAULT_LONG_MATERIAL_PACK_OPTIONS } from "./constants";
import { containsInternalId, nestHeadings, packSections } from "./markdown";
import { longMaterialKeyRank, planLongMaterialPack } from "./plan";
import { splitGimmick } from "./render-plot";
import type { LongMaterialSource } from "./source";

const libraryTitles = {
  character: "《测试书》人设",
  gimmick: "《测试书》梗",
  plot: "《测试书》剧情",
  draft: "《测试书》正文",
  other: "《测试书》其他"
};
const para = (seed: string, length: number) =>
  Array.from(
    { length: Math.ceil(length / 40) },
    (_, i) =>
      `${seed}第${i}段，这是一段用于测试的叙述文字，长度足够模拟真实内容。`
  ).join("\n\n");

function source(): LongMaterialSource {
  const tiers = [
    ["protagonist", 1],
    ["major", 3],
    ["minor", 15],
    ["passerby", 5]
  ] as const;
  const characters = tiers.flatMap(([tier, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: `character_${tier}${i}xx`,
      name: `${tier}${i}`,
      aliases: i ? [] : [`${tier}别名`],
      tier,
      typeTitle: {
        protagonist: "主角",
        major: "主要配角",
        minor: "次要配角",
        passerby: "路人"
      }[tier],
      coreProfile:
        tier === "minor" && i === 0
          ? para("长档案", 4000)
          : `## 基本信息\n\n${tier}${i}的核心档案，提到 character_major0xx。`,
      relationships: `与主角关系${i}`,
      history: tier === "passerby" ? "" : `成长轨迹${i}`,
      currentState: `最新状态${i}`
    }))
  );
  const volumes = [1, 2].map((number) => ({
    id: `volume_v${number}xxx`,
    number,
    title: `卷${number}`,
    summary: `第${number}卷梗概`
  }));
  const arcs = volumes.flatMap((volume) =>
    [1, 2, 3].map((n) => ({
      id: `arc_${volume.number}_${n}xxxx`,
      volumeId: volume.id,
      title: `剧情点${volume.number}-${n}`,
      summary: `剧情点摘要${n}`,
      outline: n === 1 ? "# 大纲\n\n细纲内容" : "",
      storyPlots: n === 1 ? [{ title: "情节一", content: "情节正文" }] : []
    }))
  );
  const chapters = Array.from({ length: 60 }, (_, i) => ({
    id: `chapter_c${i}xxxx`,
    number: i + 1,
    volumeId: volumes[i < 30 ? 0 : 1]!.id,
    arcId: arcs[Math.floor(i / 10)]!.id,
    title: `章${i + 1}`,
    card: `## 梗概\n\n${para(`第${i + 1}章`, 500)}`,
    written: true
  }));
  return {
    bookId: "longbook_test",
    title: "测试书",
    genre: "玄幻",
    bookLine:
      "# 主线\n\n主角从小镇出发，一路成长。\n\n## 核心梗与卖点\n\n废柴逆袭。\n\n### 金手指\n\n神秘戒指。\n\n## 结局\n\n登顶。",
    characterOverview: "人物概览正文",
    worldbuilding: [
      {
        id: "world_realmxx",
        title: "境界",
        overview: "九重境界",
        items: [
          { id: "worlditem_a1xx", title: "炼气", content: "第一境" },
          {
            id: "worlditem_a2xx",
            title: "大长篇",
            content: para("长设定", 7000)
          }
        ]
      },
      { id: "world_factionx", title: "势力", overview: "三大宗门", items: [] },
      { id: "world_emptyxxx", title: "空类别", overview: "", items: [] }
    ],
    characters,
    volumes,
    arcs,
    chapters,
    foreshadowing: [
      {
        title: "戒指来历",
        coreQuestion: "戒指从哪里来",
        hiddenTruth: "上古遗物",
        expectedReaderEffect: "好奇",
        span: "cross_volume",
        status: "resolved",
        beats: [
          {
            type: "plant",
            status: "committed",
            chapter: 1,
            anchor: "",
            note: "初见"
          },
          {
            type: "payoff",
            status: "committed",
            chapter: 55,
            anchor: "",
            note: "揭晓"
          }
        ]
      }
    ],
    events: [],
    connections: [],
    samples: [
      {
        chapterId: "chapter_c0xxxx",
        number: 1,
        title: "章1",
        body: para("范文", 15000)
      }
    ],
    decomposition: {
      completed: true,
      style: {
        content: "第三人称有限视角，短句多。",
        excerpts: [{ chapterOrder: 3, text: "风起了。", comment: "短句开场" }]
      },
      topics: []
    }
  };
}

function plan(
  overrides: Partial<Parameters<typeof planLongMaterialPack>[0]> = {}
) {
  return planLongMaterialPack({
    source: source(),
    options: {
      ...DEFAULT_LONG_MATERIAL_PACK_OPTIONS,
      sections: [...DEFAULT_LONG_MATERIAL_PACK_OPTIONS.sections],
      sampleChapterIds: []
    },
    libraryTitles,
    ...overrides
  });
}

describe("long material pack planning", () => {
  it("writes agent-readable entries: headers, sizes, unique names, no ids", () => {
    const { entries } = plan();
    const titles = entries.map(({ title }) => title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(entries.map(({ key }) => key)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.description.length).toBeLessThanOrEqual(150);
      expect(entry.body.length).toBeLessThanOrEqual(
        LONG_MATERIAL_ENTRY_MAX_CHARACTERS
      );
      expect(entry.body.startsWith(`# ${entry.title}\n`)).toBe(true);
      expect(containsInternalId(entry.body)).toBe(false);
    }
    expect(
      entries.find(({ key }) => key === "character:character_protagonist0xx:1")
        ?.body
    ).toContain("提到 major0");
  });

  it("puts an index entry first in every library and keeps the guide short", () => {
    const { entries } = plan();
    const first = (kind: string) =>
      entries.find((entry) => entry.kind === kind)!;
    expect(first("plot").key).toBe("guide");
    expect(first("character").key).toBe("characters:index");
    expect(first("other").key).toBe("world:index");
    expect(first("draft").key).toBe("style:1");
    expect(first("gimmick").key).toBe("gimmick:1");
    const guide = first("plot");
    expect(guide.body.length).toBeLessThanOrEqual(
      LONG_MATERIAL_INDEX_MAX_CHARACTERS
    );
    expect(guide.description.startsWith("先读这一条")).toBe(true);
    expect(guide.body).toContain("「《测试书》其他 · 世界观总览」");
    expect(guide.body).toContain("章纲共");
    expect(guide.body).toContain("仿写边界");
    expect(first("other").description.startsWith("《测试书》世界观总览")).toBe(
      true
    );
  });

  it("splits long material at natural boundaries and solos large items", () => {
    const { entries } = plan();
    const keys = entries.map(({ key }) => key);
    expect(keys).toContain("world-item:worlditem_a2xx:1");
    expect(keys).toContain("character:character_minor0xx:1");
    expect(
      keys.filter((key) => key.startsWith("sample:")).length
    ).toBeGreaterThan(1);
    expect(keys.some((key) => key.startsWith("minor:"))).toBe(true);
    expect(entries.some(({ title }) => title === "世界观·空类别")).toBe(false);
    expect(
      entries.find(({ key }) => key.startsWith("minor:"))!.body
    ).not.toContain("passerby");
  });

  it("moves the core-gimmick sections out of the book line", () => {
    const { line, gimmick } = splitGimmick(source().bookLine);
    expect(gimmick).toContain("废柴逆袭");
    expect(gimmick).toContain("神秘戒指");
    expect(line).toContain("登顶");
    expect(line).not.toContain("废柴");
  });

  it("keeps chapter grouping from the first conversion and honours sections", () => {
    const first = plan();
    const again = plan({ chaptersPerEntry: first.chaptersPerEntry });
    expect(again.entries.map(({ key }) => key)).toEqual(
      first.entries.map(({ key }) => key)
    );
    const only = plan({
      options: {
        ...DEFAULT_LONG_MATERIAL_PACK_OPTIONS,
        sections: ["worldbuilding"],
        sampleChapterIds: []
      }
    });
    expect(new Set(only.entries.map(({ kind }) => kind))).toEqual(
      new Set(["plot", "other"])
    );
  });

  it("rebuilds guide-run entries after each library index", () => {
    const { entries } = plan({
      guide: {
        guide: "仿写指南正文内容足够长，覆盖结构与节奏。",
        roles: "人设功能位正文内容足够长，覆盖功能位。",
        hooks: "爽点与钩子模式正文内容足够长，覆盖节奏。",
        opening: "开篇拆解正文内容足够长，覆盖前三章。",
        gimmick: "这一段核心梗在已有主线小节时不会重复生成。",
        style: {
          profile: "这一段文风在已有拆解记录时不会重复生成。",
          excerpts: []
        }
      }
    });
    const keys = (kind: string) =>
      entries.filter((entry) => entry.kind === kind).map(({ key }) => key);
    expect(keys("plot").slice(0, 2)).toEqual(["guide", "enhance:guide:1"]);
    expect(keys("plot").at(-1)).toBe("enhance:opening:1");
    expect(keys("character").slice(0, 2)).toEqual([
      "characters:index",
      "enhance:roles:1"
    ]);
    expect(keys("gimmick")).toEqual(["gimmick:1", "enhance:hooks:1"]);
    expect(keys("draft").some((key) => key.startsWith("enhance:style"))).toBe(
      false
    );
    expect(entries.find(({ key }) => key === "guide")!.body).toContain(
      "仿写指南已生成"
    );
    expect(
      entries.every(
        (entry) => !entry.key.startsWith("enhance:") || entry.enhanced
      )
    ).toBe(true);
    expect(longMaterialKeyRank("enhance:opening:1")).toBeGreaterThan(
      longMaterialKeyRank("timeline:1")
    );
  });

  it("nests headings below entry sections and packs by size", () => {
    expect(nestHeadings("## 一\n```\n# 代码\n```\n### 二", 2)).toBe(
      "### 一\n```\n# 代码\n```\n#### 二"
    );
    const parts = packSections(
      ["a".repeat(5000), "b".repeat(5000), "c".repeat(30000)],
      8000,
      12000
    );
    expect(parts.every((part) => part.length <= 12000)).toBe(true);
    expect(parts.join("").replace(/\n/g, "").length).toBe(40000);
  });
});
