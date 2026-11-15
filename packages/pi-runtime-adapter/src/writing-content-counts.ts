import type { PromptLocale } from "@deepwrite/contracts";
export interface WritingContentTarget {
  title: string;
  id: string;
  content: string;
}

export const WRITING_CONTENT_COUNT_DESCRIPTION =
  "创建或修改正文形成提案后，返回各目标完整内容的字数（去除空白，包含标点和 Markdown 符号）；字数对应本次提案，不代表已经落盘。";

export const WRITING_READ_CONTENT_COUNT_DESCRIPTION =
  "读取结果同时返回所读内容的当前字数（去除空白，包含标点和 Markdown 符号）；截断快照只统计已返回内容，不代表全文字数。";

export function countWritingContentCharacters(content: string): number {
  return content.replace(/\s/gu, "").length;
}

export function writingReadContentCountLine(
  content: string,
  truncated = false,
  locale?: PromptLocale
): string {
  const count = countWritingContentCharacters(content);
  if (locale === "en-US")
    return truncated
      ? `Returned characters: ${count} (truncated snapshot)`
      : `Current character count: ${count}`;
  return truncated
    ? `已返回内容字数：${count} 字（快照已截断，非全文字数）`
    : `当前字数：${count} 字`;
}

export function appendWritingContentCounts(
  message: string,
  targets: readonly WritingContentTarget[],
  locale?: PromptLocale
): string {
  return [
    message,
    ...targets.map(({ title, id, content }) =>
      locale === "en-US"
        ? `${title} (document id=${id}): ${countWritingContentCharacters(content)} characters in this proposal`
        : `${title}（文档标识=${id}）目标内容字数（本次提案）：${countWritingContentCharacters(content)} 字`
    )
  ].join("\n");
}
