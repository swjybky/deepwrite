import {
  composeEntry,
  composeParts,
  entryRef,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import {
  LONG_MATERIAL_INDEX_MAX_CHARACTERS,
  LONG_MATERIAL_MINOR_GROUP_SIZE,
  LONG_MATERIAL_SOLO_CHARACTER_CHARACTERS
} from "./limits";
import { cleanText, firstLine, nestHeadings } from "./markdown";
import type { LongMaterialPackOptions } from "./options";
import type { LongMaterialSource, LongMaterialSourceCharacter } from "./source";

const DOCUMENTS = [
  ["核心档案", "coreProfile"],
  ["人物关系", "relationships"],
  ["成长轨迹", "history"],
  ["最新状态", "currentState"]
] as const;

function characterSections(
  character: LongMaterialSourceCharacter,
  depth: number
): string[] {
  const heading = "#".repeat(depth);
  return [
    `${heading} 基本信息\n\n- 类型：${character.typeTitle}${character.aliases.length ? `\n- 别名：${character.aliases.join("、")}` : ""}`,
    ...DOCUMENTS.filter(([, field]) => cleanText(character[field])).map(
      ([label, field]) =>
        `${heading} ${label}\n\n${nestHeadings(character[field], depth)}`
    )
  ];
}

function characterLength(character: LongMaterialSourceCharacter): number {
  return DOCUMENTS.reduce(
    (total, [, field]) => total + cleanText(character[field]).length,
    0
  );
}

/** Characters that get an entry of their own; the rest share group entries. */
export function soloCharacters(
  source: LongMaterialSource,
  options: LongMaterialPackOptions
): Set<string> {
  return new Set(
    source.characters
      .filter(
        (character) =>
          character.tier === "protagonist" ||
          character.tier === "major" ||
          (character.tier === "minor" &&
            (options.characterScope === "individual" ||
              characterLength(character) >
                LONG_MATERIAL_SOLO_CHARACTER_CHARACTERS))
      )
      .map(({ id }) => id)
  );
}

function roster(
  context: LongMaterialRenderContext,
  source: LongMaterialSource,
  solo: ReadonlySet<string>,
  lineLength: number
): string[] {
  const types = [...new Set(source.characters.map((c) => c.typeTitle))];
  return types.map((type) => {
    const members = source.characters.filter((c) => c.typeTitle === type);
    if (members.every(({ tier }) => tier === "passerby"))
      return `### ${type}\n\n${members.map(({ name }) => name).join("、")}`;
    return `### ${type}\n\n${members
      .map((member) => {
        const alias = member.aliases.length
          ? `（别名：${member.aliases.slice(0, 4).join("、")}）`
          : "";
        const lead = firstLine(member.coreProfile, lineLength);
        const ref = solo.has(member.id)
          ? ` → ${entryRef(context, "character", `人物·${member.name}`)}`
          : "";
        return `- ${member.name}${alias}${lead ? `：${lead}` : ""}${ref}`;
      })
      .join("\n")}`;
  });
}

function indexEntry(
  context: LongMaterialRenderContext,
  source: LongMaterialSource,
  solo: ReadonlySet<string>
): LongMaterialPlannedEntry {
  const relations = source.characters
    .filter(({ tier }) => tier === "protagonist" || tier === "major")
    .map(({ name, relationships }) => [name, firstLine(relationships, 80)])
    .filter(([, line]) => line)
    .map(([name, line]) => `- ${name}：${line}`);
  const overview = cleanText(source.characterOverview);
  for (const lineLength of [60, 30, 0]) {
    const sections = [
      `本条是《${context.bookTitle}》人设库的索引：人物概览、按类型排列的全部人物名单与主要关系。有单独条目的人物标出了条目名。`,
      ...(overview
        ? [
            `## 人物概览\n\n${nestHeadings(overview.slice(0, lineLength ? 3000 : 1200), 2)}`
          ]
        : []),
      `## 人物名单\n\n${roster(context, source, solo, lineLength).join("\n\n")}`,
      ...(relations.length && lineLength
        ? [`## 主要关系\n\n${relations.join("\n")}`]
        : [])
    ];
    const entry = composeEntry(context, {
      key: "characters:index",
      kind: "character",
      stageId: "character",
      title: "人物总览与关系网",
      description: `《${context.bookTitle}》人物总览：全部人物名单、类型、一句话定位与主要关系；设计人物或查人名时先读。`,
      scope: "人物",
      sections
    });
    if (entry.body.length <= LONG_MATERIAL_INDEX_MAX_CHARACTERS || !lineLength)
      return entry;
  }
  throw new Error("unreachable");
}

export function renderCharacters(
  context: LongMaterialRenderContext,
  source: LongMaterialSource,
  options: LongMaterialPackOptions
): LongMaterialPlannedEntry[] {
  if (!source.characters.length && !cleanText(source.characterOverview))
    return [];
  const book = context.bookTitle;
  const solo = soloCharacters(source, options);
  const entries = [indexEntry(context, source, solo)];
  for (const character of source.characters.filter(({ id }) => solo.has(id)))
    entries.push(
      ...composeParts(context, {
        key: `character:${character.id}`,
        kind: "character",
        stageId: "character",
        title: `人物·${character.name}`,
        scope: `人物 · ${character.typeTitle}`,
        description: (part, count) =>
          `《${book}》${character.typeTitle}${character.name}${count > 1 ? `（第 ${part + 1}/${count} 篇）` : ""}的核心档案、人物关系、成长轨迹与最新状态；设计同类人物或写其出场时读。`,
        sections: characterSections(character, 2)
      })
    );
  const grouped = source.characters.filter(
    ({ id, tier }) => tier === "minor" && !solo.has(id)
  );
  for (let i = 0; i < grouped.length; i += LONG_MATERIAL_MINOR_GROUP_SIZE) {
    const members = grouped.slice(i, i + LONG_MATERIAL_MINOR_GROUP_SIZE);
    const group = i / LONG_MATERIAL_MINOR_GROUP_SIZE + 1;
    const names = members.map(({ name }) => name);
    entries.push(
      ...composeParts(context, {
        key: `minor:${group}`,
        kind: "character",
        stageId: "character",
        title: `群像·次要人物 ${group}`,
        scope: "人物 · 次要人物",
        description: () =>
          `《${book}》次要人物群像第 ${group} 组：${names.slice(0, 5).join("、")}${names.length > 5 ? ` 等 ${names.length} 人` : ""}的档案摘要；设计配角或写群戏时读。`,
        sections: members.map(
          (member) =>
            `## ${member.name}\n\n${characterSections(member, 3).join("\n\n")}`
        )
      })
    );
  }
  return entries;
}
