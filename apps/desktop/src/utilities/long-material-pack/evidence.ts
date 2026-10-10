import {
  longMaterialEvidenceTokens,
  splitGimmick,
  type LongMaterialGuideEvidence,
  type LongMaterialSource
} from "@deepwrite/contracts";

/** Share of the evidence budget each section may use. */
const SHARES = {
  bookLine: 0.1,
  volumes: 0.15,
  characters: 0.18,
  world: 0.1,
  chapters: 0.2,
  prose: 0.27
} as const;

function clip(text: string, tokens: number): string {
  const trimmed = text.trim();
  if (longMaterialEvidenceTokens(trimmed) <= tokens) return trimmed;
  // Conservative weights count 1.5 tokens per CJK character.
  const keep = Math.max(0, Math.floor(tokens / 1.5) - 20);
  return `${trimmed.slice(0, keep)}\n（以下内容因篇幅省略）`;
}

/** Evenly sampled chapter cards until the share is used. */
function sampleCards(source: LongMaterialSource, tokens: number): string {
  const cards = source.chapters.filter(({ card }) => card.trim());
  if (!cards.length) return "（没有章纲）";
  const perCard = Math.max(200, Math.floor(tokens / cards.length));
  const count = Math.max(
    1,
    Math.min(cards.length, Math.floor(tokens / perCard))
  );
  const step = cards.length / count;
  const picked = Array.from(
    { length: count },
    (_, i) => cards[Math.floor(i * step)]!
  );
  const note =
    picked.length < cards.length
      ? `（共 ${cards.length} 章，以下均匀抽样 ${picked.length} 章）\n\n`
      : "";
  return (
    note +
    picked
      .map(
        ({ number, title, card }) =>
          `### 第${number}章 ${title}\n${clip(card, perCard)}`
      )
      .join("\n\n")
  );
}

/**
 * One self-contained evidence pack for the imitation-guide run, sized to the
 * model by Main. Chapter text comes only from the opening and chosen samples.
 */
export function buildGuideEvidence(
  source: LongMaterialSource,
  tokens: number
): LongMaterialGuideEvidence {
  const share = (key: keyof typeof SHARES) => Math.floor(tokens * SHARES[key]);
  const style = source.decomposition?.style;
  const main = source.characters.filter(
    ({ tier }) => tier === "protagonist" || tier === "major"
  );
  const perCharacter = Math.floor(
    share("characters") / Math.max(1, main.length + 1)
  );
  const prose = source.samples.filter(({ body }) => body.trim());
  const perSample = Math.floor(
    (share("prose") - (style ? 2000 : 0)) / Math.max(1, prose.length)
  );
  const sections = [
    `# 《${source.title}》（${source.genre || "未设置类型"}，${source.volumes.length} 卷 ${source.chapters.length} 章）`,
    `## 全书主线\n\n${clip(source.bookLine || "（没有全书主线）", share("bookLine"))}`,
    `## 分卷与剧情点\n\n${clip(
      source.volumes
        .map((volume) => {
          const arcs = source.arcs
            .filter((arc) => arc.volumeId === volume.id)
            .map((arc) => `- ${arc.title}：${arc.summary.trim()}`);
          return `### 第${volume.number}卷 ${volume.title}\n${volume.summary.trim()}\n${arcs.join("\n")}`;
        })
        .join("\n\n") || "（没有分卷）",
      share("volumes")
    )}`,
    `## 人物\n\n${clip(source.characterOverview || "", perCharacter)}\n\n${main
      .map(
        (person) =>
          `### ${person.name}（${person.typeTitle}）\n${clip(`${person.coreProfile}\n${person.relationships}\n${person.history}`, perCharacter)}`
      )
      .join("\n\n")}\n\n其余人物：${
      source.characters
        .filter(({ tier }) => tier !== "protagonist" && tier !== "major")
        .map(({ name, typeTitle }) => `${name}（${typeTitle}）`)
        .join("、") || "无"
    }`,
    `## 世界观\n\n${clip(
      source.worldbuilding
        .map(
          (category) =>
            `### ${category.title}\n${category.overview.trim()}\n条目：${category.items.map(({ title }) => title).join("、")}`
        )
        .join("\n\n") || "（没有世界观）",
      share("world")
    )}`,
    `## 章纲\n\n${sampleCards(source, share("chapters"))}`,
    ...(style ? [`## 已有文风画像\n\n${clip(style.content, 2000)}`] : []),
    `## 原文样章\n\n${
      prose
        .map(
          ({ number, title, body }) =>
            `### 第${number}章 ${title}\n${clip(body, perSample)}`
        )
        .join("\n\n") || "（没有可用的原文）"
    }`
  ];
  return {
    bookTitle: source.title,
    evidence: clip(sections.join("\n\n"), tokens),
    needs: {
      style: !style,
      gimmick: !splitGimmick(source.bookLine).gimmick
    }
  };
}
