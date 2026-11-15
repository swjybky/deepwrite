import type { PromptLocale } from "@deepwrite/contracts";
export const WRITING_EDIT_SUMMARY_DESCRIPTION =
  "建议提供本次改动的一句话说明，会显示在审批卡上；可省略，省略或留空时系统根据目标和操作生成说明。";

export function resolveWritingEditSummary(
  summary: string | undefined,
  title: string,
  params: {
    content?: unknown;
    replacements?: unknown;
    append?: string;
    insert?: unknown;
    meta?: unknown;
  },
  locale?: PromptLocale
): string {
  const provided = summary?.trim();
  if (provided) return provided;
  const hasContent =
    params.content !== undefined ||
    params.replacements !== undefined ||
    params.append !== undefined ||
    params.insert !== undefined;
  if (locale === "en-US") {
    const action =
      params.content === ""
        ? "Clear"
        : params.replacements
          ? "Revise"
          : "Update";
    return `${action} ${hasContent ? "text" : "properties"} of “${title.slice(0, 800)}”`;
  }
  const action =
    params.content === "" ? "清空" : params.replacements ? "局部修改" : "更新";
  const scope = hasContent
    ? params.meta
      ? params.content === ""
        ? "内容并更新属性"
        : "内容及属性"
      : "内容"
    : "属性";
  return `${action}《${title.slice(0, 800)}》的${scope}`;
}
