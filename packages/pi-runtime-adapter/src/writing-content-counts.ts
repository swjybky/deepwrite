export interface WritingContentTarget {
  title: string;
  id: string;
  content: string;
}

export const WRITING_CONTENT_COUNT_DESCRIPTION =
  "创建或修改正文形成提案后，返回各目标完整内容的字数（去除空白，包含标点和 Markdown 符号）；字数对应本次提案，不代表已经落盘。";

export function appendWritingContentCounts(
  message: string,
  targets: readonly WritingContentTarget[]
): string {
  return [
    message,
    ...targets.map(
      ({ title, id, content }) =>
        `${title}（文档标识=${id}）目标内容字数（本次提案）：${content.replace(/\s/gu, "").length} 字`
    )
  ].join("\n");
}
