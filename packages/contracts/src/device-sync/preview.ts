import type { SyncItem } from "./schemas";
import type { SyncIssue } from "./types";
import { mergeSyncItems } from "./merge";
import { sameSyncContent, syncEqual } from "./value";
import { isRecord } from "@deepwrite/shared";

const LABELS: Record<string, string> = {
  title: "名称",
  description: "说明",
  summary: "概述",
  order: "顺序",
  status: "状态",
  genre: "题材",
  subtype: "子类型",
  citationStyle: "引用体例",
  enabled: "启用",
  foundation: "研究底座",
  thesisOverview: "研究立意与核心贡献",
  terminology: "术语与符号表",
  cards: "文献与证据卡",
  citeKey: "引用键",
  cardType: "卡片类型",
  frameworkStages: "论证框架阶段",
  manuscript: "正文目录",
  brief: "写作指引",
  state: "节末状态",
  characterStructure: "人物结构",
  items: "条目",
  plotStages: "剧情阶段",
  draft: "正文",
  sections: "章节",
  documents: "文档",
  entries: "资料",
  chapters: "章节",
  characters: "人物",
  world: "世界观",
  worldReveals: "世界信息",
  linkedMaterialIdsByKind: "绑定素材",
  linkedSkillIdsByKind: "绑定技能",
  linkedMaterialIds: "绑定素材",
  linkedSkillIds: "绑定技能",
  memberIds: "分组包含",
  customTag: "自定义标签",
  materialLibraryIds: "素材库",
  skillLibraryIds: "技能库",
  character: "人物",
  gimmick: "创意",
  plot: "剧情",
  general: "通用",
  style: "文风",
  other: "其他",
  body: "正文",
  characterState: "人物状态",
  wordCountRequirement: "字数要求",
  format: "格式",
  path: "文档位置",
  apiKey: "API Key"
};
function describe(
  value: unknown,
  other: unknown,
  prefix: string,
  lines: string[]
): void {
  if (syncEqual(value, other)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const identity =
        isRecord(entry) && typeof entry.id === "string" ? entry.id : null;
      const comparison = Array.isArray(other)
        ? identity
          ? other.find((v: unknown) => isRecord(v) && v.id === identity)
          : other[index]
        : undefined;
      const name =
        isRecord(entry) && typeof entry.title === "string"
          ? entry.title
          : `第 ${index + 1} 项`;
      describe(entry, comparison, `${prefix} / ${name}`, lines);
    });
    if (Array.isArray(other))
      for (const entry of other) {
        if (
          isRecord(entry) &&
          typeof entry.id === "string" &&
          !value.some((v: unknown) => isRecord(v) && v.id === entry.id)
        )
          lines.push(
            `${prefix} / ${typeof entry.title === "string" ? entry.title : entry.id}：已删除`
          );
      }
    if (!value.length) lines.push(`${prefix}：空`);
    return;
  }
  if (isRecord(value)) {
    for (const key of new Set([
      ...Object.keys(value),
      ...Object.keys(isRecord(other) ? other : {})
    ])) {
      if (
        [
          "id",
          "schemaVersion",
          "revision",
          "projectRevision",
          "updatedAt",
          "createdAt",
          "kind"
        ].includes(key)
      )
        continue;
      describe(
        value[key],
        isRecord(other) ? other[key] : undefined,
        [prefix, LABELS[key] ?? key].filter(Boolean).join(" / "),
        lines
      );
    }
    return;
  }
  lines.push(
    `${prefix}：${value === null || value === undefined ? "无" : String(value)}`
  );
}
export function syncVersionPreview(
  item: SyncItem | null,
  path: string,
  other?: SyncItem | null
): string {
  if (!item) return "此版本已删除";
  if (path === "作品名称") return item.title;
  if (path === "作品")
    return [
      item.title,
      ...Object.entries(item.files)
        .filter(([name]) => name.endsWith(".md"))
        .map(([name, body]) => `${name}\n${body}`)
    ].join("\n\n");
  const content = item.files[path];
  if (content === undefined) return "此版本不含该内容";
  if (!path.endsWith(".json")) return content;
  const lines: string[] = [];
  describe(
    JSON.parse(content),
    other?.files[path] ? JSON.parse(other.files[path]) : undefined,
    "",
    lines
  );
  return lines.length ? lines.join("\n") : "与对方的结构相同";
}

/** Resolve the disputed fields while retaining changes that already merge safely. */
export function resolveSyncVersion(
  issue: SyncIssue,
  preferred: SyncItem | null
): SyncItem | null {
  if (
    !issue.base ||
    (issue.reason === "delete" && sameSyncContent(preferred, issue.local))
  )
    return preferred;
  let result = issue.local;
  for (const version of issue.versions)
    result = mergeSyncItems(issue.base, result, version.item, {
      preferred
    }).item;
  return result;
}
