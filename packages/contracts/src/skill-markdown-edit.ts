import {
  writeMarkdownMetadataFields,
  type MarkdownMetadataEditResult,
  type MarkdownMetadataFields
} from "./markdown-metadata-edit";

/** Uses the same single-line, literal field values as parseSkillMarkdown. */
export function readSkillMarkdownMetadata(
  content: string
): Partial<MarkdownMetadataFields> {
  const lines = content.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) return {};
  const fields: Partial<MarkdownMetadataFields> = {};
  for (const key of ["name", "description"] as const) {
    const line = lines
      .slice(1, end)
      .find((value) => new RegExp(`^${key}\\s*:`).test(value));
    if (line !== undefined)
      fields[key] = line.slice(line.indexOf(":") + 1).trim();
  }
  return fields;
}

/** Changes a draft only; skill validation and the normal save/conflict flow remain intact. */
export function updateSkillMarkdownMetadata(
  content: string,
  values: MarkdownMetadataFields
): MarkdownMetadataEditResult {
  const name = values.name.replace(/\s+/g, " ").trim();
  const description = values.description.replace(/\s+/g, " ").trim();
  if (!name || !description)
    return { updated: false, message: "请填写技能名称和使用说明。" };

  const lines = content.split(/\r?\n/);
  let headerEnd: number | undefined;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end < 0)
      return {
        updated: false,
        message: "技能说明头部缺少结束分隔符 ---，请先在正文编辑器中调整。"
      };
    const header = lines.slice(1, end);
    for (const key of ["name", "description"] as const) {
      const matches = header.filter((line) =>
        new RegExp(`^${key}\\s*:`).test(line)
      );
      const nextLine = matches.length
        ? header[header.indexOf(matches[0]!) + 1]
        : undefined;
      if (matches.length > 1 || (nextLine && /^\s+\S/.test(nextLine)))
        return {
          updated: false,
          message: "技能说明包含重复字段或多行配置，请先在正文编辑器中调整。"
        };
    }
    if (
      header.some((line) => /^[A-Za-z_][\w-]*\s*:/.test(line)) ||
      header.every((line) => !line.trim() || line.trimStart().startsWith("#"))
    )
      headerEnd = (content.match(/[^\n]*(?:\n|$)/g) ?? [])
        .slice(0, end + 1)
        .join("").length;
  } else if (content.startsWith("\uFEFF---")) {
    return {
      updated: false,
      message: "技能首行包含不可见字符，请先在正文编辑器中调整为 ---。"
    };
  }
  return {
    updated: true,
    content: writeMarkdownMetadataFields(content, headerEnd, {
      name,
      description
    })
  };
}
