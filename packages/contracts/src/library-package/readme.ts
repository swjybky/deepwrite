import {
  LIBRARY_TYPE_NAMES,
  MATERIAL_KIND_NAMES,
  SKILL_KIND_NAMES,
  type LibraryPackageLocale
} from "./labels";
import {
  LIBRARY_PACKAGE_MANIFEST_FILE,
  type LibraryPackageDomain
} from "./manifest";
import type { CatalogLibrary } from "../catalog";

const TEXT = {
  "zh-CN": {
    type: "类型",
    genre: "题材",
    entries: "条目",
    members: "成员库",
    exported: "导出",
    overview: "简介",
    contents: "目录",
    usage: "使用说明",
    none: "无",
    count: (count: string) => `${count} 个`,
    entryCount: (count: string) => `${count} 个条目`,
    characters: (count: string) => `${count} 字`,
    separator: "，",
    open: "（",
    close: "）",
    group: { material: "素材分组", skill: "技能分组" },
    unavailable: "库文件夹不可用，未导出",
    usageLines: (domain: LibraryPackageDomain) => [
      "每个条目是一个独立的 Markdown 文件，文件名就是条目标题，开头的编号表示库内顺序。可以用任何文本编辑器、Obsidian、Typora 打开，也可以上传到其他 AI 工具作为参考资料。",
      `导回 DeepWrite：在“${domain === "material" ? "素材库" : "技能库"}”栏目的“＋”菜单选择“导入${domain === "material" ? "素材" : "技能"}包…”，选择这个压缩包或解压后的文件夹。`,
      `${LIBRARY_PACKAGE_MANIFEST_FILE} 只用于导回 DeepWrite 时还原分类、顺序和库信息，其他软件可以忽略。`
    ]
  },
  "en-US": {
    type: "Type",
    genre: "Genre",
    entries: "Entries",
    members: "Libraries",
    exported: "Exported",
    overview: "Overview",
    contents: "Contents",
    usage: "How to use",
    none: "None",
    count: (count: string) => count,
    entryCount: (count: string) => `${count} entries`,
    characters: (count: string) => `${count} characters`,
    separator: ", ",
    open: " (",
    close: ")",
    group: { material: "Material group", skill: "Skill group" },
    unavailable: "library folder unavailable, not exported",
    usageLines: (domain: LibraryPackageDomain) => [
      "Each entry is a separate Markdown file named after the entry title; the leading number keeps the library order. Open them in any text editor, Obsidian or Typora, or upload them to other AI tools as reference material.",
      `To bring them back into DeepWrite, choose “Import ${domain === "material" ? "Material" : "Skill"} Package…” from the “+” menu of the ${domain === "material" ? "Material Library" : "Skill Library"} section and select this archive or its extracted folder.`,
      `${LIBRARY_PACKAGE_MANIFEST_FILE} only lets DeepWrite restore categories, order and library details; other apps can ignore it.`
    ]
  }
} as const;

export interface ReadmeEntryLine {
  title: string;
  /** Path relative to the library folder, with "/" separators. */
  file: string;
  stageName: string;
  characters: number;
}

export interface ReadmeContext {
  locale: LibraryPackageLocale;
  domain: LibraryPackageDomain;
  generator: string;
  exportedAt: string;
}

function linkText(value: string): string {
  return value.replace(/([\\[\]])/gu, "\\$1");
}

function link(title: string, path: string): string {
  return `[${linkText(title)}](<${path}>)`;
}

function exportedLine(context: ReadmeContext): string {
  return `- ${TEXT[context.locale].exported}：${context.exportedAt.slice(0, 10)} · ${context.generator}`;
}

function usage(context: ReadmeContext): string[] {
  const text = TEXT[context.locale];
  return [
    `## ${text.usage}`,
    "",
    ...text.usageLines(context.domain).map((line) => `- ${line}`)
  ];
}

export function libraryKindName(
  library: CatalogLibrary,
  locale: LibraryPackageLocale
): string {
  return "materialKind" in library
    ? MATERIAL_KIND_NAMES[library.materialKind][locale]
    : SKILL_KIND_NAMES[library.skillKind][locale];
}

export function renderLibraryReadme(
  library: CatalogLibrary,
  entries: readonly ReadmeEntryLine[],
  staged: boolean,
  context: ReadmeContext
): string {
  const text = TEXT[context.locale];
  const format = (value: number) => value.toLocaleString(context.locale);
  const libraryType =
    "materialType" in library ? library.materialType : library.skillType;
  const genres =
    "parentGenre" in library
      ? [library.parentGenre, library.subGenre].filter((genre) => genre.trim())
      : [];
  const lines = [
    `# ${library.title}`,
    "",
    `- ${text.type}：${libraryKindName(library, context.locale)} · ${LIBRARY_TYPE_NAMES[libraryType][context.locale]}`,
    ...(genres.length ? [`- ${text.genre}：${genres.join(" / ")}`] : []),
    `- ${text.entries}：${text.count(format(entries.length))}`,
    exportedLine(context),
    "",
    `## ${text.overview}`,
    "",
    library.overview.trim() || text.none,
    "",
    `## ${text.contents}`,
    ""
  ];
  if (entries.length === 0) lines.push(text.none, "");
  let currentStage: string | undefined;
  let number = 0;
  for (const entry of entries) {
    if (staged && entry.stageName !== currentStage) {
      if (currentStage !== undefined) lines.push("");
      lines.push(`### ${entry.stageName}`, "");
      currentStage = entry.stageName;
      number = 0;
    }
    number += 1;
    const detail = [
      ...(staged ? [] : [entry.stageName]),
      text.characters(format(entry.characters))
    ].join(text.separator);
    lines.push(
      `${number}. ${link(entry.title, entry.file)}${text.open}${detail}${text.close}`
    );
  }
  if (entries.length) lines.push("");
  return [...lines, ...usage(context), ""].join("\n");
}

export interface ReadmeGroupMember {
  kindName: string;
  title: string;
  /** Library folder relative to the package root; empty when unavailable. */
  directory: string;
  entryCount: number;
}

export function renderGroupReadme(
  title: string,
  members: readonly ReadmeGroupMember[],
  readmeFile: string,
  context: ReadmeContext
): string {
  const text = TEXT[context.locale];
  const format = (value: number) => value.toLocaleString(context.locale);
  const exported = members.filter(({ directory }) => directory);
  const lines = [
    `# ${title}`,
    "",
    `- ${text.type}：${text.group[context.domain]}`,
    `- ${text.members}：${text.count(format(exported.length))}`,
    exportedLine(context),
    "",
    `## ${text.members}`,
    ""
  ];
  members.forEach((member, index) => {
    const label = member.title
      ? `${member.kindName} · ${member.title}`
      : member.kindName;
    lines.push(
      member.directory
        ? `${index + 1}. ${link(label, `${member.directory}/${readmeFile}`)}${text.open}${text.entryCount(format(member.entryCount))}${text.close}`
        : `${index + 1}. ${label}${text.open}${text.unavailable}${text.close}`
    );
  });
  return [...lines, "", ...usage(context), ""].join("\n");
}
