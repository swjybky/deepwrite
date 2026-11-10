import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind
} from "@deepwrite/contracts";
import {
  clipped,
  isRecord,
  list,
  record,
  serializeJson,
  stringValue,
  type WarningCollector
} from "./normalize";

export function extractGenre(
  book: Record<string, unknown> | null,
  override: string | undefined,
  warnings: WarningCollector
): string {
  if (override?.trim()) {
    return clipped(override.trim(), 120, warnings, "题材").trim();
  }
  const direct = stringValue(book?.genre).trim();
  if (direct) return clipped(direct, 120, warnings, "题材").trim();
  const firstCategory = list(book?.categories)
    .map((value) => stringValue(value).trim())
    .find(Boolean);
  return clipped(firstCategory || "长篇", 120, warnings, "题材").trim();
}

export function legacyLinkIds(
  value: unknown,
  warnings: WarningCollector,
  label: string
): string[] {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
  const ids: string[] = [];
  for (const rawValue of rawValues) {
    const candidate = isRecord(rawValue)
      ? stringValue(rawValue.id).trim()
      : stringValue(rawValue).trim();
    if (!candidate) {
      if (rawValue != null) {
        warnings.add(`${label}包含无法解析的空 ID；原始值已写入迁移证据。`);
        warnings.preserve(
          `${label}（无法解析值）`,
          label,
          serializeJson(rawValue)
        );
      }
      continue;
    }
    if (candidate.length > 512) {
      warnings.add(
        `${label}包含超过当前 ID 上限的值；完整 ID 已写入迁移证据，绑定字段保留前 512 个字符。`
      );
      warnings.preserve(`${label}（超长 ID）`, label, candidate);
    }
    const normalized = candidate.slice(0, 512);
    if (!ids.includes(normalized)) ids.push(normalized);
  }
  return ids;
}

export function normalizeLegacyMaterialLinks(
  book: Record<string, unknown> | null,
  warnings: WarningCollector
): LinkedMaterialIdsByKind {
  const source = record(book?.linked_material_ids_by_kind);
  const result: LinkedMaterialIdsByKind = {
    character: legacyLinkIds(source.character, warnings, "人设素材库绑定"),
    gimmick: legacyLinkIds(source.gimmick, warnings, "梗与灵感素材库绑定"),
    plot: legacyLinkIds(source.plot, warnings, "剧情素材库绑定"),
    draft: legacyLinkIds(source.draft, warnings, "正文素材库绑定"),
    other: legacyLinkIds(source.other, warnings, "其他素材库绑定")
  };
  for (const [kind, rawValue] of Object.entries(source)) {
    if (kind in result) continue;
    const unknownIds = legacyLinkIds(
      rawValue,
      warnings,
      `未知素材分类“${kind}”`
    );
    for (const id of unknownIds) {
      if (!Object.values(result).some((values) => values.includes(id))) {
        result.other.push(id);
      }
    }
    if (unknownIds.length) {
      warnings.add(`旧版未知素材分类“${kind}”已保守归入 other。`);
      warnings.preserveDecision(
        "coerce",
        `book.json.linked_material_ids_by_kind.${kind}`,
        "当前长篇不识别该素材分类，绑定已保守归入 other。",
        rawValue
      );
    }
  }
  for (const id of legacyLinkIds(
    book?.linked_material_id,
    warnings,
    "旧版单值素材库绑定"
  )) {
    if (!Object.values(result).some((values) => values.includes(id))) {
      result.other.push(id);
    }
  }
  return result;
}

export function normalizeLegacySkillLinks(
  book: Record<string, unknown> | null,
  warnings: WarningCollector
): LinkedSkillIdsByKind {
  const source = record(book?.linked_skill_ids_by_kind);
  const result: LinkedSkillIdsByKind = {
    general: legacyLinkIds(source.general, warnings, "通用技能库绑定"),
    plot: legacyLinkIds(source.plot, warnings, "剧情技能库绑定"),
    style: legacyLinkIds(source.style, warnings, "文风技能库绑定"),
    other: legacyLinkIds(source.other, warnings, "其他技能库绑定")
  };
  for (const [kind, rawValue] of Object.entries(source)) {
    if (kind in result) continue;
    const unknownIds = legacyLinkIds(
      rawValue,
      warnings,
      `未知技能分类“${kind}”`
    );
    for (const id of unknownIds) {
      if (!Object.values(result).some((values) => values.includes(id))) {
        result.other.push(id);
      }
    }
    if (unknownIds.length) {
      warnings.add(`旧版未知技能分类“${kind}”已保守归入 other。`);
      warnings.preserveDecision(
        "coerce",
        `book.json.linked_skill_ids_by_kind.${kind}`,
        "当前长篇不识别该技能分类，绑定已保守归入 other。",
        rawValue
      );
    }
  }
  for (const id of legacyLinkIds(
    book?.linked_skill_id,
    warnings,
    "旧版单值技能库绑定"
  )) {
    if (!Object.values(result).some((values) => values.includes(id))) {
      result.other.push(id);
    }
  }
  return result;
}
