export const MATERIAL_NAME_PREVIEW_LENGTH = 80;
export const MATERIAL_DESCRIPTION_PREVIEW_LENGTH = 160;

export const MATERIAL_METADATA_AUTHORING_GUIDANCE =
  "新建素材时，建议在每条 Markdown 顶部用 --- 包裹可选的 name 和 description 单行字段，说明素材名称与适用场景，然后保留正式素材正文。两个字段都不强制；旧素材缺少配置仍可正常读取和修改，不要为了补齐配置拒绝任务或批量改写旧素材。库介绍不需要此头部，写入仍遵循原有预览与提案流程。";

export type MaterialMetadataState =
  "configured" | "partial" | "legacy" | "malformed";

export interface MaterialMarkdownResult {
  state: MaterialMetadataState;
  name?: string;
  description?: string;
  /** Original body, without a safely recognized header. Never used for saving. */
  body: string;
  issues: string[];
  /** Offset in the original string immediately after the closing delimiter. */
  headerEnd?: number;
}

export interface MaterialMetadata {
  name: string;
  description: string;
  nameSource: "configured" | "title" | "id";
  descriptionSource: "configured" | "excerpt" | "fallback";
}

export function materialPreview(text: string, maximum: number): string {
  const plain = text.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
  return plain.length > maximum
    ? `${plain.slice(0, Math.max(0, maximum - 1))}…`
    : plain;
}

function scalar(value: string): string | undefined {
  const text = value.trim();
  if (!text) return "";
  if (text.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(text);
      return typeof decoded === "string" && !/[\r\n]/.test(decoded)
        ? decoded.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (text.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(text)
      ? text.slice(1, -1).replace(/''/g, "'").trim()
      : undefined;
  }
  if (/^[|>[{&*!]|^(?:null|~)$/.test(text)) return undefined;
  return text.replace(/\s+#.*$/, "").trim();
}

/** Optional metadata is advisory. No result invalidates the original material. */
export function parseMaterialMarkdown(content: string): MaterialMarkdownResult {
  const unchanged = (state: MaterialMetadataState, issues: string[] = []) => ({
    state,
    issues,
    body: content
  });
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") return unchanged("legacy");
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    return lines.some((line) => /^(name|description)\s*:/.test(line))
      ? unchanged("malformed", ["说明头部缺少结束分隔符 ---，仍可读取原文。"])
      : unchanged("legacy");
  }
  const header = lines.slice(1, end);
  const fieldPattern = /^[A-Za-z_][\w-]*\s*:/;
  if (!header.some((line) => fieldPattern.test(line))) {
    return unchanged("legacy");
  }
  if (
    header.some(
      (line) =>
        line.trim() &&
        !line.trimStart().startsWith("#") &&
        !fieldPattern.test(line) &&
        !/^\s/.test(line)
    )
  ) {
    return unchanged("malformed", [
      "说明头部存在无法识别的内容，仍可读取原文。"
    ]);
  }
  const issues: string[] = [];
  const fields: { name?: string; description?: string } = {};
  for (const key of ["name", "description"] as const) {
    const matches = header.filter((line) =>
      new RegExp(`^${key}\\s*:`).test(line)
    );
    if (matches.length > 1) {
      issues.push(`${key} 重复定义，已使用默认信息。`);
      continue;
    }
    if (!matches.length) continue;
    const line = matches[0]!;
    const value = scalar(line.slice(line.indexOf(":") + 1));
    const nextLine = header[header.indexOf(line) + 1];
    if (value === undefined || (nextLine && /^\s+\S/.test(nextLine))) {
      issues.push(`${key} 建议使用单行文本，已使用默认信息。`);
    } else if (value) {
      fields[key] = value;
    }
  }
  // Find the original offset so CRLF and BOM are preserved by editing helpers.
  const originalLines = content.match(/[^\n]*(?:\n|$)/g) ?? [];
  const headerEnd = originalLines.slice(0, end + 1).join("").length;
  return {
    ...fields,
    state: issues.length
      ? "malformed"
      : fields.name && fields.description
        ? "configured"
        : fields.name || fields.description
          ? "partial"
          : "legacy",
    issues,
    body: content.slice(headerEnd),
    headerEnd
  };
}

function bodyExcerpt(body: string): string {
  const paragraph: string[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (
      !trimmed ||
      /^#{1,6}\s|^(?:[-*_]\s*){3,}$|^(?:name|description)\s*:/.test(trimmed)
    ) {
      if (paragraph.length) break;
      continue;
    }
    const plain = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^>\s*|^[-*+]\s+|^\d+\.\s+/, "")
      .replace(/<[^>]*>/g, "")
      .replace(/[*_`]/g, "");
    if (plain.trim()) paragraph.push(plain);
    if (paragraph.join(" ").length >= MATERIAL_DESCRIPTION_PREVIEW_LENGTH)
      break;
  }
  return materialPreview(
    paragraph.join(" "),
    MATERIAL_DESCRIPTION_PREVIEW_LENGTH
  );
}

export function resolveMaterialMetadata(input: {
  id: string;
  title: string;
  content: string;
}): MaterialMetadata {
  const parsed = parseMaterialMarkdown(input.content);
  const excerpt = parsed.description ? "" : bodyExcerpt(parsed.body);
  return {
    name: materialPreview(
      parsed.name || input.title.trim() || input.id,
      MATERIAL_NAME_PREVIEW_LENGTH
    ),
    description: materialPreview(
      parsed.description || excerpt || "暂无说明，可读取原文了解内容",
      MATERIAL_DESCRIPTION_PREVIEW_LENGTH
    ),
    nameSource: parsed.name
      ? "configured"
      : input.title.trim()
        ? "title"
        : "id",
    descriptionSource: parsed.description
      ? "configured"
      : excerpt
        ? "excerpt"
        : "fallback"
  };
}
