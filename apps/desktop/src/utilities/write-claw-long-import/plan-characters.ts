import {
  longCharacterCoreProfileFileId,
  longCharacterRelationshipsFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  clipped,
  clippedTextDocument,
  list,
  record,
  stringValue,
  title,
  type DeterministicIdRegistry,
  type WarningCollector
} from "./normalize";
import { characterPath, type ImportDocumentBuilder } from "./plan-documents";
import { toJsonFileText } from "@deepwrite/shared";

const CHARACTER_GROUPS = [
  ["protagonists", "protagonist"],
  ["major_supporting", "major_supporting"],
  ["minor_supporting", "minor_supporting"],
  ["passersby", "passerby"]
] as const;

const CHARACTER_OVERVIEW_GROUPS = [
  ["protagonist", "主角"],
  ["major_supporting", "主要配角"],
  ["minor_supporting", "次要配角"],
  ["passerby", "路人"]
] as const;

function sourceRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return list(record(value).entries);
}

export function buildCharacterOverviewMarkdown(
  characters: LongWorkspaceIndexSnapshot["characters"]
): string {
  if (characters.length === 0) return "";
  const sections = CHARACTER_OVERVIEW_GROUPS.map(([group, label]) => {
    const rows = characters
      .filter((character) => character.group === group)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      )
      .map((character) => {
        const aliases = character.aliases.length
          ? `；别名：${character.aliases.join("、")}`
          : "";
        return `- id=\`${character.id}\` ${character.name}${aliases}`;
      });
    return [`## ${label}`, "", ...(rows.length ? rows : ["（暂无）"])].join(
      "\n"
    );
  });
  return [
    "# 人物概览",
    "",
    "按分组统计当前阶段全部人物的简单信息；智能体应先读本概览，再按 id 直接读取人物文档。",
    "",
    ...sections,
    ""
  ].join("\n");
}

export function buildImportedCharacters(
  charactersSource: Record<string, unknown>,
  ids: DeterministicIdRegistry,
  documents: ImportDocumentBuilder,
  warnings: WarningCollector
): {
  characters: LongWorkspaceIndexSnapshot["characters"];
  characterFiles: LongWorkspaceIndexSnapshot["characterFiles"];
} {
  const characters: LongWorkspaceIndexSnapshot["characters"] = [];
  const characterFiles: LongWorkspaceIndexSnapshot["characterFiles"] = [];
  for (const [legacyGroup, group] of CHARACTER_GROUPS) {
    const rows = sourceRows(charactersSource[legacyGroup]);
    rows.forEach((rawCharacter, index) => {
      const character = record(rawCharacter);
      const rawAliases = list(character.aliases);
      if (rawAliases.length > 64) {
        warnings.preserve(
          `人物 ${index + 1} 别名（完整列表）`,
          `characters.${legacyGroup}[${index}].aliases`,
          toJsonFileText(rawAliases)
        );
        warnings.add(
          `人物 ${index + 1} 别名超过 64 项；结构保留前 64 项，完整列表已写入迁移证据。`
        );
      }
      const characterId = ids.allocate(
        "character",
        "character",
        character.id,
        `${legacyGroup}-${index + 1}`
      );
      const normalizedAliases = rawAliases
        .map((alias, aliasIndex) =>
          clipped(
            stringValue(alias).trim(),
            120,
            warnings,
            `人物 ${index + 1} 别名 ${aliasIndex + 1}`
          ).trim()
        )
        .filter(Boolean);
      normalizedAliases.forEach((alias, aliasIndex) => {
        if (normalizedAliases.indexOf(alias) !== aliasIndex) {
          warnings.preserveDecision(
            "merge",
            `long_workspace.json.characters.${legacyGroup}.entries[${index}].aliases[${aliasIndex}]`,
            "规范化后重复的人物别名已合并。",
            rawAliases[aliasIndex]
          );
        }
      });
      characters.push({
        id: characterId,
        name: title(
          character.name,
          `未命名人物${index + 1}`,
          warnings,
          `人物 ${index + 1} 姓名`
        ),
        group,
        order: index + 1,
        aliases: normalizedAliases
          .filter(
            (alias, aliasIndex, aliases) =>
              aliases.indexOf(alias) === aliasIndex
          )
          .slice(0, 64)
      });
      characterFiles.push({
        characterId,
        coreProfile: documents.add(
          longCharacterCoreProfileFileId(characterId),
          characterPath(characterId, "core-profile.md"),
          clippedTextDocument(character.core_profile, warnings, "人物核心档案")
        ),
        relationships: documents.add(
          longCharacterRelationshipsFileId(characterId),
          characterPath(characterId, "relationships.md"),
          clippedTextDocument(character.relationships, warnings, "人物关系")
        )
      });
    });
  }
  return { characters, characterFiles };
}
